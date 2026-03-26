from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email


class EmailAuthenticationForm(AuthenticationForm):
    """
    Login form that uses the built-in username field, but labels it as Email.
    """

    username = forms.EmailField(
        label="Email",
        widget=forms.EmailInput(
            attrs={
                "autofocus": True,
                "autocomplete": "off",
                "autocapitalize": "none",
                "spellcheck": "false",
                "placeholder": "you@example.com",
            }
        ),
    )

    password = forms.CharField(
        label="Password",
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "autocomplete": "off",
            }
        ),
    )


class EmailUserCreationForm(UserCreationForm):
    """
    Signup form that uses the built-in username field, but as an Email field.
    """

    username = forms.EmailField(
        label="Email",
        validators=[validate_email],
        widget=forms.EmailInput(
            attrs={
                "autofocus": True,
                "autocomplete": "off",
                "autocapitalize": "none",
                "spellcheck": "false",
                "placeholder": "you@example.com",
            }
        ),
    )


class EmailSetPasswordForm(forms.Form):
    """
    Used after OTP verification to set a new password for an existing user.
    """

    password1 = forms.CharField(
        label="New password",
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "autocomplete": "off",
            }
        ),
    )
    password2 = forms.CharField(
        label="Confirm new password",
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "autocomplete": "off",
            }
        ),
    )

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._user = user

    def clean_password1(self):
        pw1 = self.cleaned_data.get("password1") or ""
        if self._user is not None:
            validate_password(pw1, self._user)
        return pw1

    def clean(self):
        cleaned = super().clean()
        pw1 = cleaned.get("password1")
        pw2 = cleaned.get("password2")
        if pw1 and pw2 and pw1 != pw2:
            self.add_error("password2", "Passwords do not match.")
        return cleaned
