import { useNavigate } from "react-router-dom";
import { PageContainer } from "../../components/layout/PageContainer";

export const Welcome = () => {
  const navigate = useNavigate();

  const handleEnter = () => {
    localStorage.setItem("shop_welcome_seen", "true");
    navigate("/shop");
  };

  return (
    <PageContainer>
      <div className="welcome">
        <h1>Быстро. Безопасно. Официально.</h1>
        <div className="welcome-grid">
          <div className="welcome-card">
            <div className="icon">⚡</div>
            <div>Мгновенная обработка</div>
          </div>
          <div className="welcome-card">
            <div className="icon">🔒</div>
            <div>Безопасная оплата</div>
          </div>
          <div className="welcome-card">
            <div className="icon">📦</div>
            <div>Автовыдача / поддержка</div>
          </div>
        </div>
        <button className="button primary" onClick={handleEnter}>
          Перейти в магазин
        </button>
      </div>
    </PageContainer>
  );
};
