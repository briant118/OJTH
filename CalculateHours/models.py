from django.db import models
from django.conf import settings
from django.utils import timezone

from django.contrib.auth import get_user_model


class OJTEntry(models.Model):
    """
    Persisted copy of a single OJT session row from the browser.

    We use `client_key` (stored in browser localStorage) to isolate data per device,
    without requiring authentication.
    """

    client_key = models.CharField(max_length=64, db_index=True)
    client_id = models.CharField(max_length=128)  # corresponds to localStorage `entry.id`

    date = models.DateField()
    time_in = models.TimeField()
    time_out = models.TimeField(null=True, blank=True)

    # Completed sessions only; can be null for open sessions.
    hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("client_key", "client_id")
        ordering = ["-date", "time_in"]

    def __str__(self) -> str:
        return f"{self.date} {self.time_in} -> {self.time_out or 'OPEN'}"


User = get_user_model()


class EmailVerificationOTP(models.Model):
    """
    4-digit OTP sent to the user's email (we use `user.username` as email).
    Used to activate the account after signup.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="email_otps")
    code = models.CharField(max_length=4)

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def is_verified(self) -> bool:
        return self.verified_at is not None

    def __str__(self) -> str:
        return f"OTP {self.code} for {self.user_id} (exp {self.expires_at})"


class UserProfile(models.Model):
    """
    App-level user data created at signup so it is visible in project tables.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    email = models.EmailField()
    is_email_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Profile<{self.user_id}> {self.email}"
