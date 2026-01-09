import { useEffect } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { useNavigate } from "react-router-dom";

export const ShopHome = () => {
  const navigate = useNavigate();
  const categories = [
    { id: 1, name: "FREE FIRE", style: "free-fire" },
    { id: 2, name: "STEAM", style: "steam" },
    { id: 3, name: "PUBG MOBILE", style: "pubg-mobile" }
  ];

  useEffect(() => {
    if (!localStorage.getItem("shop_welcome_seen")) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  return (
    <PageContainer>
      <header className="shop-header">
        <div className="shop-header-left">
          <span className="icon-button">←</span>
          <span className="header-label">Назад</span>
        </div>
        <div className="shop-header-right">
          <span className="icon-button">⌄</span>
          <span className="icon-button">⋮</span>
        </div>
      </header>
      <section className="hero-banner">
        <div className="hero-logo">UM4D</div>
      </section>
      <section className="category-stack">
        {categories.map((category) => (
          <div key={category.id} className={`category-card ${category.style}`}>
            <span className="category-title">{category.name}</span>
          </div>
        ))}
      </section>
    </PageContainer>
  );
};
