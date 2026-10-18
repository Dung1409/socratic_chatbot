import type { ReactNode } from "react";
import { GraduationCap, MessageCircle, UserRound, CornerDownRight } from "lucide-react";
import { APP_TAGLINE, APP_TITLE } from "@/lib/brand";

function Brand() {
  return (
    <div className="auth-brand" aria-label={APP_TITLE}>
      <span className="auth-brand-mark">
        <GraduationCap size={25} aria-hidden="true" />
      </span>
      <div>
        <p className="auth-wordmark">
          Trợ lý ảo <span>AI</span>
        </p>
        <p className="auth-brand-caption">{APP_TAGLINE}</p>
      </div>
    </div>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-introduction" aria-labelledby="auth-intro-heading">
        <Brand />
        <div className="auth-intro-content">
          <p className="auth-tagline">Học Văn bằng tư duy, không chỉ bằng ghi nhớ.</p>
          <h2 id="auth-intro-heading">
            Mỗi câu hỏi mở ra <span>một cách nghĩ mới.</span>
          </h2>
          <p className="auth-description">
            Cùng gia sư AI khám phá tác phẩm, rèn luyện lập luận và phát triển tư duy phản biện qua
            những cuộc đối thoại gợi mở.
          </p>
          <figure className="auth-conversation">
            <figcaption className="auth-conversation-header">
              <MessageCircle size={18} aria-hidden="true" />
              <span>
                Một cuộc đối thoại gợi mở<small>Minh họa cách trao đổi với trợ lý AI</small>
              </span>
            </figcaption>
            <div className="auth-conversation-body">
              <div className="auth-message">
                <span className="auth-avatar">
                  <GraduationCap size={17} aria-hidden="true" />
                </span>
                <div>
                  <p className="auth-speaker">Gia sư AI</p>
                  <p>Em nghĩ điều gì khiến nhân vật đưa ra quyết định ấy?</p>
                </div>
              </div>
              <div className="auth-message auth-message-student">
                <span className="auth-avatar">
                  <UserRound size={17} aria-hidden="true" />
                </span>
                <div>
                  <p className="auth-speaker">Học sinh</p>
                  <p>Em nghĩ vì nhân vật phải lựa chọn giữa trách nhiệm và mong muốn cá nhân.</p>
                </div>
              </div>
              <div className="auth-message">
                <span className="auth-avatar">
                  <GraduationCap size={17} aria-hidden="true" />
                </span>
                <div>
                  <p className="auth-speaker">Gia sư AI</p>
                  <p>
                    Đó là một nhận xét thú vị. Em có thể tìm chi tiết trong tác phẩm để làm rõ suy
                    nghĩ đó không?
                  </p>
                </div>
              </div>
            </div>
          </figure>
          <p className="auth-intro-note">
            <CornerDownRight size={17} aria-hidden="true" />
            Tự tìm lời giải, từng câu hỏi một.
          </p>
        </div>
      </section>
      <section className="auth-form-panel" aria-labelledby="auth-form-heading">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-container">{children}</div>
      </section>
    </main>
  );
}
