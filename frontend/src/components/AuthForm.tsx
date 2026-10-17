import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/components/AuthProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import "@/auth.css";

type Values = { name: string; email: string; password: string; confirmation: string };
type Field = keyof Values;
type Errors = Partial<Record<Field, string>>;
const emailSchema = z.string().max(254).email();

function validate(values: Values, register: boolean): Errors {
  const errors: Errors = {};
  if (register && !values.name.trim()) errors.name = "Vui lòng nhập tên hiển thị.";
  else if (register && Array.from(values.name.trim()).length > 100)
    errors.name = "Tên hiển thị không quá 100 ký tự.";
  if (!values.email.trim()) errors.email = "Vui lòng nhập email.";
  else if (!emailSchema.safeParse(values.email.trim()).success)
    errors.email = "Email chưa đúng định dạng. Ví dụ: ban@example.com.";
  const length = Array.from(values.password).length;
  if (!length) errors.password = "Vui lòng nhập mật khẩu.";
  else if (register && length < 8) errors.password = "Mật khẩu cần ít nhất 8 ký tự.";
  else if (length > 128) errors.password = "Mật khẩu không quá 128 ký tự.";
  if (register && !values.confirmation) errors.confirmation = "Vui lòng xác nhận mật khẩu.";
  else if (register && values.confirmation !== values.password)
    errors.confirmation = "Mật khẩu xác nhận chưa khớp.";
  return errors;
}

function PasswordGuidance({ password }: { password: string }) {
  const length = Array.from(password).length;
  const variety = [/[a-z]/i, /\d/, /[^a-z\d]/i].filter((pattern) => pattern.test(password)).length;
  const score = length < 8 ? 0 : length < 12 ? 1 : variety < 3 ? 2 : 3;
  const labels = ["Chưa đủ 8 ký tự", "Cơ bản", "Khá", "Tốt"];
  return (
    <div className="auth-password-guidance" id="password-guidance">
      <p>Tối thiểu 8 ký tự. Nên dùng một cụm từ khó đoán.</p>
      <div className="auth-strength" aria-live="polite" aria-atomic="true">
        <span className="auth-strength-bars" aria-hidden="true">
          {[1, 2, 3].map((level) => (
            <span key={level} data-active={length > 0 && score >= level} />
          ))}
        </span>
        <span>{password ? `Độ mạnh tham khảo: ${labels[score]}` : "Độ mạnh tham khảo"}</span>
      </div>
    </div>
  );
}

export function AuthForm({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const [values, setValues] = useState<Values>({
    name: "",
    email: "",
    password: "",
    confirmation: "",
  });
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [visible, setVisible] = useState({ password: false, confirmation: false });
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const validation = validate(values, register);
  const fieldError = (field: Field) =>
    serverErrors[field] || (touched[field] ? validation[field] : undefined);

  useEffect(() => {
    if (serverErrors.email && !busy)
      (formRef.current?.elements.namedItem("email") as HTMLInputElement | null)?.focus();
  }, [serverErrors.email, busy]);

  const update = (field: Field, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setServerErrors((previous) => ({ ...previous, [field]: undefined }));
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    setTouched({ name: true, email: true, password: true, confirmation: true });
    setError(null);
    setServerErrors({});
    const firstInvalid = (Object.keys(validation) as Field[])[0];
    if (firstInvalid) {
      (form.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      if (register) {
        await auth.register(values.name.trim(), values.email.trim(), values.password);
        toast.success("Tạo tài khoản thành công", {
          description: "Chào mừng bạn đến với không gian tự học SocraVăn.",
        });
      } else await auth.login(values.email.trim(), values.password);
      setValues((previous) => ({ ...previous, password: "", confirmation: "" }));
    } catch (cause) {
      if (register && cause instanceof ApiError && cause.status === 409) {
        setServerErrors({ email: cause.message });
      } else {
        setError(
          cause instanceof ApiError && cause.status === 0
            ? "Không thể kết nối. Vui lòng thử lại trong giây lát."
            : cause instanceof Error
              ? cause.message
              : "Không thực hiện được yêu cầu. Vui lòng thử lại.",
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const field = (key: Field, label: string, placeholder: string) => {
    const password = key === "password" || key === "confirmation";
    const message = fieldError(key);
    const shown = password && visible[key];
    const hint = key === "password" && register ? "password-guidance" : "";
    return (
      <div className="auth-field">
        <label htmlFor={`auth-${key}`}>{label}</label>
        <div className="auth-input-wrap">
          <Input
            id={`auth-${key}`}
            name={key}
            type={password ? (shown ? "text" : "password") : key === "email" ? "email" : "text"}
            autoComplete={
              key === "name"
                ? "nickname"
                : key === "email"
                  ? "email"
                  : register
                    ? "new-password"
                    : "current-password"
            }
            autoCapitalize={key === "email" ? "none" : undefined}
            spellCheck={key === "email" || password ? false : undefined}
            required
            minLength={password ? (register ? 8 : 1) : undefined}
            maxLength={key === "name" ? 100 : key === "email" ? 254 : 128}
            placeholder={placeholder}
            value={values[key]}
            onChange={(event) => update(key, event.target.value)}
            onBlur={() => setTouched((previous) => ({ ...previous, [key]: true }))}
            aria-invalid={!!message}
            aria-describedby={
              [hint, message ? `auth-${key}-error` : ""].filter(Boolean).join(" ") || undefined
            }
            className={password ? "auth-input auth-password-input" : "auth-input"}
          />
          {password && (
            <button
              className="auth-password-toggle"
              type="button"
              aria-label={`${shown ? "Ẩn" : "Hiện"} ${key === "confirmation" ? "mật khẩu xác nhận" : "mật khẩu"}`}
              aria-pressed={!!shown}
              aria-controls={`auth-${key}`}
              onClick={() => setVisible((previous) => ({ ...previous, [key]: !previous[key] }))}
            >
              {shown ? (
                <EyeOff size={19} aria-hidden="true" />
              ) : (
                <Eye size={19} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
        <div className="auth-field-feedback" aria-live="polite">
          {message && (
            <p id={`auth-${key}-error`} className="auth-field-error">
              {message}
            </p>
          )}
        </div>
        {key === "password" && register && <PasswordGuidance password={values.password} />}
      </div>
    );
  };

  return (
    <AuthLayout>
      <div className="auth-form-content" key={register ? "register" : "login"}>
        <header className="auth-form-header">
          <h1 id="auth-form-heading">
            {register ? "Bắt đầu hành trình học cùng SocraVăn" : "Chào mừng bạn trở lại"}
          </h1>
          <p>
            {register
              ? "Tạo tài khoản để khám phá Ngữ văn theo cách của riêng bạn."
              : "Đăng nhập để tiếp tục hành trình khám phá Ngữ văn."}
          </p>
        </header>
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
          aria-busy={busy}
        >
          <fieldset disabled={busy} className="auth-fields">
            <legend className="sr-only">
              {register ? "Thông tin tạo tài khoản" : "Thông tin đăng nhập"}
            </legend>
            {register && field("name", "Tên hiển thị", "Bạn muốn được gọi là gì?")}
            {field("email", "Email", "ban@example.com")}
            {field(
              "password",
              "Mật khẩu",
              register ? "Tạo mật khẩu của bạn" : "Nhập mật khẩu của bạn",
            )}
            {register && field("confirmation", "Xác nhận mật khẩu", "Nhập lại mật khẩu")}
            {error && (
              <p role="alert" className="auth-form-error">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{error}</span>
              </p>
            )}
            <Button className="auth-submit" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="auth-spinner" aria-hidden="true" />
                  {register ? "Đang tạo tài khoản…" : "Đang đăng nhập…"}
                </>
              ) : (
                <>
                  {register ? "Tạo tài khoản" : "Đăng nhập"}
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </fieldset>
          <span className="sr-only" role="status">
            {busy
              ? register
                ? "Đang tạo tài khoản. Vui lòng chờ."
                : "Đang đăng nhập. Vui lòng chờ."
              : ""}
          </span>
        </form>
        <p className="auth-form-footer">
          {register ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
          <Link to={register ? "/dang-nhap" : "/dang-ky"}>
            {register ? "Đăng nhập" : "Đăng ký ngay"}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
