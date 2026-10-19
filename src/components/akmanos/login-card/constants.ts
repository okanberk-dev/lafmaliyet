export const LOGIN_TITLE = "Welcome back";
export const LOGIN_SUBTITLE = "Sign in to your AkmanOS workspace";
export const LOGIN_EMAIL_LABEL = "Email";
export const LOGIN_EMAIL_PLACEHOLDER = "you@company.com";
export const LOGIN_PASSWORD_LABEL = "Password";
export const LOGIN_PASSWORD_PLACEHOLDER = "Enter your password";
export const LOGIN_REMEMBER_LABEL = "Remember me";
export const LOGIN_FORGOT_LABEL = "Forgot password?";
export const LOGIN_SUBMIT_LABEL = "Sign in";
export const LOGIN_DIVIDER_LABEL = "or continue with";
export const LOGIN_SIGNUP_PROMPT = "Don't have an account?";
export const LOGIN_SIGNUP_LABEL = "Create account";

export const LOGIN_SOCIAL_PROVIDERS = [
  { id: "google" as const, label: "Google" },
  { id: "github" as const, label: "GitHub" },
];

export type LoginSocialProviderId = "google" | "github";
