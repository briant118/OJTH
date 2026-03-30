import json
import random
import smtplib
from datetime import datetime, timedelta

from django.db import transaction, IntegrityError
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model, login as django_login
from django.contrib.auth import views as auth_views
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from django.contrib.auth import logout

from .forms import EmailAuthenticationForm, EmailSetPasswordForm, EmailUserCreationForm
from .models import EmailVerificationOTP, OJTEntry, UserProfile


OTP_TTL_MINUTES = 5


def _pending_keys():
    return {
        "purpose": "otp_pending_purpose",
        "email": "otp_pending_email",
        "password_hash": "otp_pending_password_hash",
        "code": "otp_pending_code",
        "expires_at": "otp_pending_expires_at",
        "viewed": "otp_pending_viewed",
    }


def _clear_pending_otp(request) -> None:
    keys = _pending_keys()
    for k in keys.values():
        request.session.pop(k, None)


def _clear_password_reset_state(request) -> None:
    # Holds the user id while we are on `change_password_confirm/`.
    request.session.pop("password_reset_user_id", None)


def _parse_iso_datetime(value: str):
    # Expected to be produced by `.isoformat()`.
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt


def _send_verification_otp(*, to_email: str, from_email: str, is_resend: bool):
    """
    Sends a 4-digit OTP email.

    Returns (otp_code, expires_at, remaining_seconds).
    """
    otp_code = f"{random.randint(1000, 9999)}"
    expires_at = timezone.now() + timedelta(minutes=OTP_TTL_MINUTES)

    send_mail(
        "OJT Hours verification code",
        (
            "Greetings!\n\n"
            + (
                "Here is your new OJT Hours verification code.\n\n"
                if is_resend
                else "Welcome to OJT Hours.\n\n"
            )
            + f"Your 4-digit OTP code is: {otp_code}\n"
            + f"This code will expire in {OTP_TTL_MINUTES} minutes.\n\n"
            + "If you didn't request this, you can ignore this email.\n\n"
            + "— OJT Hours"
        ),
        from_email,
        [to_email],
        fail_silently=False,
    )

    remaining = int(max(0, (expires_at - timezone.now()).total_seconds()))
    return otp_code, expires_at, remaining


def _cleanup_pending_unverified_users(*, minutes: int = 10) -> None:
    """
    Delete accounts that never complete OTP verification.

    This is best-effort "automatic" cleanup; it runs whenever verify-related
    pages are hit. For real background scheduling, use a cron/task scheduler.
    """
    cutoff = timezone.now() - timedelta(minutes=minutes)
    User = get_user_model()

    stale_user_ids = (
        EmailVerificationOTP.objects.filter(verified_at__isnull=True, created_at__lte=cutoff)
        .values_list("user_id", flat=True)
        .distinct()
    )

    # Only delete accounts that are still inactive (never verified).
    User.objects.filter(id__in=stale_user_ids, is_active=False).delete()


def signup(request):
    # If they come back (refresh/back), discard any previous pending OTP credentials.
    if request.method == "GET":
        _clear_pending_otp(request)

    if request.method != "POST":
        form = EmailUserCreationForm()
        return render(request, "registration/signup.html", {"form": form})

    form = EmailUserCreationForm(request.POST)
    if not form.is_valid():
        return render(request, "registration/signup.html", {"form": form})

    user = form.save(commit=False)
    email = (user.username or "").strip()
    password_hash = user.password

    try:
        validate_email(email)
    except ValidationError:
        form.add_error("username", "Email must be valid for OTP verification.")
        return render(request, "registration/signup.html", {"form": form})

    from_email = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    if not from_email:
        form.add_error(None, "Email is not configured on the server.")
        return render(request, "registration/signup.html", {"form": form})

    try:
        otp_code, expires_at, otp_remaining = _send_verification_otp(
            to_email=email,
            from_email=from_email,
            is_resend=False,
        )
    except smtplib.SMTPAuthenticationError:
        form.add_error(
            None,
            "Email server rejected login. If using Gmail, set EMAIL_HOST_USER to your Gmail address and "
            "EMAIL_HOST_PASSWORD to a Google App Password (not your normal password).",
        )
        return render(request, "registration/signup.html", {"form": form})
    except Exception:
        form.add_error(None, "Could not send OTP email. Please try again.")
        return render(request, "registration/signup.html", {"form": form})

    keys = _pending_keys()
    request.session[keys["purpose"]] = "signup"
    request.session[keys["email"]] = email
    request.session[keys["password_hash"]] = password_hash
    request.session[keys["code"]] = otp_code
    request.session[keys["expires_at"]] = expires_at.isoformat()
    request.session[keys["viewed"]] = False
    request.session.set_expiry(600)  # TTL guard, plus browser-close expiry in settings.

    return redirect("verify_email")


def verify_email(request):
    keys = _pending_keys()
    purpose = request.session.get(keys["purpose"])
    pending_email = request.session.get(keys["email"])
    pending_password_hash = request.session.get(keys["password_hash"])
    pending_code = request.session.get(keys["code"])
    pending_expires_at_iso = request.session.get(keys["expires_at"])
    pending_viewed = bool(request.session.get(keys["viewed"], False))

    if not pending_email or not pending_code or not pending_expires_at_iso or not purpose:
        # Discarded/expired pending credentials: force restart of the flow.
        _clear_pending_otp(request)
        _clear_password_reset_state(request)
        return redirect("signup" if purpose == "signup" else "login")

    pending_expires_at = _parse_iso_datetime(pending_expires_at_iso)
    if not pending_expires_at or timezone.now() >= pending_expires_at:
        _clear_pending_otp(request)
        _clear_password_reset_state(request)
        return redirect("signup" if purpose == "signup" else "login")

    # Discard pending data on refresh/back: only allow a single "GET view" until verified.
    if request.method == "GET":
        if pending_viewed:
            _clear_pending_otp(request)
            _clear_password_reset_state(request)
            return redirect("signup" if purpose == "signup" else "login")
        request.session[keys["viewed"]] = True

    remaining = int(max(0, (pending_expires_at - timezone.now()).total_seconds()))

    if request.method == "GET":
        return render(
            request,
            "registration/verify_email.html",
            {"otp_remaining": remaining, "flow": purpose},
        )

    action = request.POST.get("action")
    if action == "resend":
        from_email = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
        if not from_email:
            return render(
                request,
                "registration/verify_email.html",
                {"error": "Email is not configured on the server.", "otp_remaining": 0, "flow": purpose},
            )

        try:
            otp_code, expires_at, new_remaining = _send_verification_otp(
                to_email=pending_email,
                from_email=from_email,
                is_resend=True,
            )
        except smtplib.SMTPAuthenticationError:
            return render(
                request,
                "registration/verify_email.html",
                {"error": "Email server rejected login. Please check SMTP settings.", "otp_remaining": 0, "flow": purpose},
            )
        except Exception:
            return render(
                request,
                "registration/verify_email.html",
                {"error": "Could not resend OTP. Please try again.", "otp_remaining": 0, "flow": purpose},
            )

        request.session[keys["code"]] = otp_code
        request.session[keys["expires_at"]] = expires_at.isoformat()
        # keep viewed=True so refresh still discards
        request.session.set_expiry(600)

        return render(
            request,
            "registration/verify_email.html",
            {"message": "OTP resent. Please check your email.", "otp_remaining": new_remaining, "flow": purpose},
        )

    # Verify OTP
    code = (request.POST.get("otp") or "").strip()
    if code and code == pending_code and timezone.now() < pending_expires_at:
        User = get_user_model()
        email = pending_email
        password_hash = pending_password_hash

        if purpose == "signup":
            if not password_hash:
                _clear_pending_otp(request)
                return redirect("signup")

            # Create user only after OTP verification.
            existing = User.objects.filter(username=email).first()
            if existing:
                if existing.is_active:
                    _clear_pending_otp(request)
                    _clear_password_reset_state(request)
                    return redirect("login")
                user_obj = existing
            else:
                user_obj = User(username=email, email=email, is_active=True)

            user_obj.is_active = True
            user_obj.password = password_hash
            try:
                user_obj.save()
            except IntegrityError:
                _clear_pending_otp(request)
                return redirect("login")

            profile, _ = UserProfile.objects.get_or_create(user=user_obj, defaults={"email": email})
            profile.email = email
            profile.is_email_verified = True
            profile.save(update_fields=["email", "is_email_verified"])

            _clear_pending_otp(request)
            django_login(request, user_obj)
            return redirect("home")

        if purpose == "password_reset":
            user_obj = User.objects.filter(username=email).first()
            if not user_obj:
                _clear_pending_otp(request)
                return redirect("login")

            request.session["password_reset_user_id"] = user_obj.pk
            _clear_pending_otp(request)
            return redirect("change_password_confirm")

        # Unknown purpose
        _clear_pending_otp(request)
        return redirect("login")

    return render(
        request,
        "registration/verify_email.html",
        {"error": "Invalid or expired code. Try again.", "otp_remaining": remaining, "flow": purpose},
    )


def verify_email_start(request):
    """
    Lets a user continue verification later (if they left the OTP screen).
    They enter email+password; if correct and not verified, we resend OTP and redirect to verify page.
    """
    if request.method == "GET":
        _clear_pending_otp(request)

    if request.method != "POST":
        return render(request, "registration/verify_email_start.html")

    email = (request.POST.get("email") or "").strip()
    password = request.POST.get("password") or ""

    try:
        validate_email(email)
    except ValidationError:
        return render(request, "registration/verify_email_start.html", {"error": "Enter a valid email."})

    # Use the same password validators as signup.
    form = EmailUserCreationForm(
        data={
            "username": email,
            "password1": password,
            "password2": password,
        }
    )
    if not form.is_valid():
        # Show the first validation error as a simple user message.
        first_error = None
        for field in form:
            if field.errors:
                first_error = field.errors.as_text().strip()
                break
        if not first_error and form.non_field_errors():
            first_error = form.non_field_errors()[0]
        return render(
            request,
            "registration/verify_email_start.html",
            {"error": first_error or "Invalid signup details. Please try again."},
        )

    from_email = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    if not from_email:
        return render(
            request,
            "registration/verify_email_start.html",
            {"error": "Email is not configured on the server."},
        )

    user = form.save(commit=False)
    password_hash = user.password

    try:
        otp_code, expires_at, otp_remaining = _send_verification_otp(
            to_email=email,
            from_email=from_email,
            is_resend=True,
        )
    except smtplib.SMTPAuthenticationError:
        return render(
            request,
            "registration/verify_email_start.html",
            {
                "error": "Email server rejected login. If using Gmail, set EMAIL_HOST_USER to your Gmail address and "
                "EMAIL_HOST_PASSWORD to a Google App Password (not your normal password).",
            },
        )
    except Exception:
        return render(
            request,
            "registration/verify_email_start.html",
            {"error": "Could not send OTP. Please try again."},
        )

    keys = _pending_keys()
    request.session[keys["purpose"]] = "signup"
    request.session[keys["email"]] = email
    request.session[keys["password_hash"]] = password_hash
    request.session[keys["code"]] = otp_code
    request.session[keys["expires_at"]] = expires_at.isoformat()
    request.session[keys["viewed"]] = False
    request.session.set_expiry(600)

    return redirect("verify_email")


def change_password_start(request):
    """
    Step 1 of change-password:
    - user enters email
    - we send OTP to that email
    - OTP verification will redirect to change_password_confirm
    """
    if request.method == "GET":
        _clear_pending_otp(request)
        _clear_password_reset_state(request)

    if request.method != "POST":
        return render(request, "registration/change_password_start.html")

    _clear_password_reset_state(request)  # new request -> clear any old "step 2" state

    email = (request.POST.get("email") or "").strip()
    try:
        validate_email(email)
    except ValidationError:
        return render(request, "registration/change_password_start.html", {"error": "Enter a valid email."})

    User = get_user_model()
    user_obj = User.objects.filter(username=email).first()
    if not user_obj or not user_obj.is_active:
        return render(
            request,
            "registration/change_password_start.html",
            {"error": "Account not found (or not active)."},
        )

    from_email = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    if not from_email:
        return render(
            request,
            "registration/change_password_start.html",
            {"error": "Email is not configured on the server."},
        )

    try:
        otp_code, expires_at, otp_remaining = _send_verification_otp(
            to_email=email,
            from_email=from_email,
            is_resend=False,
        )
    except smtplib.SMTPAuthenticationError:
        return render(
            request,
            "registration/change_password_start.html",
            {
                "error": "Email server rejected login. If using Gmail, set EMAIL_HOST_USER and "
                "EMAIL_HOST_PASSWORD to your Google App Password.",
            },
        )
    except Exception:
        return render(request, "registration/change_password_start.html", {"error": "Could not send OTP. Please try again."})

    keys = _pending_keys()
    request.session[keys["purpose"]] = "password_reset"
    request.session[keys["email"]] = email
    # Intentionally do NOT store a password hash until OTP is verified + user submits new password.
    request.session.pop(keys["password_hash"], None)
    request.session[keys["code"]] = otp_code
    request.session[keys["expires_at"]] = expires_at.isoformat()
    request.session[keys["viewed"]] = False
    request.session.set_expiry(600)

    return redirect("verify_email")


def change_password_confirm(request):
    """
    Step 2 of change-password:
    - after OTP verification, we set password
    - email/password are persisted only now
    """
    User = get_user_model()
    pending_user_id = request.session.get("password_reset_user_id")
    if not pending_user_id:
        return redirect("login")

    user_obj = User.objects.filter(pk=pending_user_id).first()
    if not user_obj:
        request.session.pop("password_reset_user_id", None)
        return redirect("login")

    if request.method == "POST":
        form = EmailSetPasswordForm(data=request.POST, user=user_obj)
        if form.is_valid():
            user_obj.set_password(form.cleaned_data["password1"])
            user_obj.save(update_fields=["password"])
            request.session.pop("password_reset_user_id", None)
            django_login(request, user_obj)
            return redirect("home")
    else:
        form = EmailSetPasswordForm(user=user_obj)

    return render(request, "registration/change_password_confirm.html", {"form": form})


def clear_pending_otp(request):
    _clear_pending_otp(request)
    _clear_password_reset_state(request)
    return redirect("login")


class OtpAwareLoginView(auth_views.LoginView):
    """
    Visiting the login page means the user backed out of OTP verification.
    Clear pending OTP registration data so they must start over.
    """

    template_name = "registration/login.html"
    redirect_authenticated_user = True
    authentication_form = EmailAuthenticationForm

    def dispatch(self, request, *args, **kwargs):
        if request.method in ("GET", "POST"):
            _clear_pending_otp(request)
            _clear_password_reset_state(request)
        return super().dispatch(request, *args, **kwargs)


@login_required(login_url="login")
def home(request):
    return render(request, "home.html")


@login_required(login_url="login")
def calculate(request):
    return render(request, "calculate.html")


@login_required(login_url="login")
def process(request):
    return render(request, "process.html")


@login_required(login_url="login")
def time_in_out(request):
    return render(request, "time-in-out.html")


@login_required(login_url="login")
def profile(request):
    return render(
        request,
        "profile.html",
        {
            "email": getattr(request.user, "email", "") or request.user.username,
        },
    )


@login_required(login_url="login")
@require_http_methods(["POST"])
def profile_delete(request):
    if request.POST.get("confirm") != "YES":
        return redirect("profile")

    user_obj = request.user
    password = request.POST.get("password") or ""
    if not user_obj.check_password(password):
        return render(
            request,
            "profile.html",
            {
                "email": getattr(user_obj, "email", "") or user_obj.username,
                "error": "Incorrect password. Account was not deleted.",
            },
        )

    user_pk = user_obj.pk
    logout(request)
    request.session.flush()
    # Delete after logout/session flush to avoid request.user edge cases.
    get_user_model().objects.filter(pk=user_pk).delete()
    return redirect("signup")


def _parse_date(date_str: str):
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def _parse_time(time_str: str):
    return datetime.strptime(time_str, "%H:%M").time()


def _entries_api_requires_auth(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    return None


@csrf_exempt
@require_http_methods(["GET"])
def api_entries_list(request):
    """
    GET /api/entries/
    Returns OJT rows for the signed-in user (same DB as auth: Supabase when configured).
    """
    deny = _entries_api_requires_auth(request)
    if deny is not None:
        return deny

    rows = OJTEntry.objects.filter(user=request.user).order_by("date", "time_in")
    entries = [
        {
            "id": r.client_id,
            "date": r.date.strftime("%Y-%m-%d"),
            "timeIn": r.time_in.strftime("%H:%M"),
            "timeOut": r.time_out.strftime("%H:%M") if r.time_out else None,
            "hours": float(r.hours) if r.hours is not None else None,
        }
        for r in rows
    ]
    return JsonResponse({"entries": entries})


@csrf_exempt
@require_http_methods(["POST"])
def api_entries_sync(request):
    """
    POST /api/entries/sync/
    Body: { entries: [ {id,date,timeIn,timeOut,hours}, ... ] }

    Upserts rows for the signed-in user and deletes server rows missing from the payload.
    """
    deny = _entries_api_requires_auth(request)
    if deny is not None:
        return deny

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("Invalid JSON")

    raw_entries = payload.get("entries") or []
    if not isinstance(raw_entries, list):
        return HttpResponseBadRequest("Missing entries")

    normalized = []
    client_ids = set()

    for e in raw_entries:
        try:
            client_id = e.get("id")
            date_str = e.get("date")
            tin = e.get("timeIn")
            tout = e.get("timeOut")
            if not client_id or not date_str or not tin:
                continue

            date_val = _parse_date(date_str)
            time_in_val = _parse_time(tin)
            time_out_val = _parse_time(tout) if tout else None

            hours_val = e.get("hours")
            if hours_val is None and time_out_val:
                dt_in = datetime.combine(date_val, time_in_val)
                dt_out = datetime.combine(date_val, time_out_val)
                if dt_out < dt_in:
                    dt_out = dt_out + timedelta(days=1)
                hours_val = (dt_out - dt_in).total_seconds() / 3600.0

            normalized.append(
                {
                    "client_id": str(client_id),
                    "date": date_val,
                    "time_in": time_in_val,
                    "time_out": time_out_val,
                    "hours": hours_val,
                }
            )
            client_ids.add(str(client_id))
        except Exception:
            continue

    with transaction.atomic():
        OJTEntry.objects.filter(user=request.user).exclude(client_id__in=client_ids).delete()
        for row in normalized:
            OJTEntry.objects.update_or_create(
                user=request.user,
                client_id=row["client_id"],
                defaults={
                    "client_key": "",
                    "date": row["date"],
                    "time_in": row["time_in"],
                    "time_out": row["time_out"],
                    "hours": row["hours"],
                },
            )

    return JsonResponse({"ok": True, "count": len(normalized)})