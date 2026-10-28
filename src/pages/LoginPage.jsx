import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import ThemeToggle from "../components/common/ThemeToggle.jsx";
import { Field } from "../components/wizard/FormControls.jsx";
import { MIN_PASSWORD_LENGTH, validateCredentials } from "../utils/auth.js";

const COPY = {
  login: { kicker: "WELCOME BACK", title: "Log in to Gather", lead: "Pick up your plan, diary and grocery list where you left off.", submit: "Log in", busy: "Logging in…", switchText: "New here?", switchAction: "Create an account" },
  signup: { kicker: "GET STARTED", title: "Create your account", lead: "Your plan, diary and favorites stay separate from anyone else using this device.", submit: "Create account", busy: "Creating account…", switchText: "Already have an account?", switchAction: "Log in" },
};

export default function LoginPage() {
  const { user, loading, logIn, signUp } = useAuth();
  const { darkMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState(location.state?.mode === "signup" ? "signup" : "login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", remember: true });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];
  // After signing in, return to the page that sent the user here.
  const destination = location.state?.from ?? "/";

  if (user) return <Navigate to={destination} replace />;
  if (loading) return <div className="auth-loading" role="status">Loading…</div>;

  const update = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  function switchMode() {
    setMode(mode === "login" ? "signup" : "login");
    setErrors({});
  }

  async function submit(event) {
    event.preventDefault();
    const found = validateCredentials(form, mode);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    const result = await (mode === "login" ? logIn(form) : signUp(form));
    setBusy(false);
    if (result.error) setErrors(result.error);
    else navigate(destination, { replace: true });
  }

  const passwordToggle = <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>;

  return (
    <div className={`wizard-page login-page ${darkMode ? "theme-dark" : ""}`}>
      <header className="wizard-header login-header"><ThemeToggle /></header>
      <main className="login-main">
        <form className="wizard-card login-card" onSubmit={submit} noValidate>
          <div className="wizard-card-heading">
            <div className="wizard-kicker"><span className="wizard-kicker-dot" />{copy.kicker}</div>
            <h1>{copy.title}</h1>
            <p>{copy.lead}</p>
          </div>
          <div className="wizard-fields">
            {errors.form && <p className="notice notice-warning" role="alert">{errors.form}</p>}
            {mode === "signup" && <Field label="Name" error={errors.name}>{(props) => <input {...props} autoComplete="name" value={form.name} onChange={update("name")} />}</Field>}
            <Field label="Email" error={errors.email}>{(props) => <input {...props} type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={form.email} onChange={update("email")} />}</Field>
            <Field label="Password" hint={mode === "signup" ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined} error={errors.password}>
              {(props) => <div className="password-input"><input {...props} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={update("password")} />{passwordToggle}</div>}
            </Field>
            {mode === "signup" && <Field label="Confirm password" error={errors.confirmPassword}>{(props) => <input {...props} type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.confirmPassword} onChange={update("confirmPassword")} />}</Field>}
            <label className="login-remember"><input type="checkbox" checked={form.remember} onChange={update("remember")} />Keep me signed in on this device</label>
          </div>
          <button className="button button-primary wizard-next login-submit" type="submit" disabled={busy}>{busy ? copy.busy : copy.submit} {!busy && <ArrowRight size={16} />}</button>
          <p className="login-switch">{copy.switchText} <button className="link-button" type="button" onClick={switchMode}>{copy.switchAction}</button></p>
        </form>
      </main>
    </div>
  );
}
