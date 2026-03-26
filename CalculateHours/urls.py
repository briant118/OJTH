from django.contrib.auth import views as auth_views
from django.urls import path
from . import views
from .forms import EmailAuthenticationForm

urlpatterns = [
    path(
        "login/",
        views.OtpAwareLoginView.as_view(),
        name="login",
    ),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("signup/", views.signup, name="signup"),
    path("verify-email/", views.verify_email, name="verify_email"),
    path("verify-email/start/", views.verify_email_start, name="verify_email_start"),
    path("verify-email/clear/", views.clear_pending_otp, name="clear_otp"),
    path("change-password/start/", views.change_password_start, name="change_password_start"),
    path(
        "change-password/confirm/",
        views.change_password_confirm,
        name="change_password_confirm",
    ),
    path('', views.home, name='home'),
    path('calculate/', views.calculate, name='calculate'),
    path('process/', views.process, name='process'),
    path('time-in-out/', views.time_in_out, name='time_in_out'),
    path('profile/', views.profile, name='profile'),
    path('profile/delete/', views.profile_delete, name='profile_delete'),
    path('api/entries/', views.api_entries_list, name='api_entries_list'),
    path('api/entries/sync/', views.api_entries_sync, name='api_entries_sync'),
]