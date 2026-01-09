import { PageContainer } from "../../components/layout/PageContainer";
import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useState } from "react";
import { validatePromo } from "../../api/promos.api";

export const Cart = () => {
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.totalPrice());
  const navigate = useNavigate();
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [discount, setDiscount] = useState<number>(0);
  const [validating, setValidating] = useState(false);

  const handlePromo = async () => {
    if (!promoCode) {
      return;
    }
    setValidating(true);
    setPromoError(null);
    try {
      const promo = await validatePromo(promoCode);
      const nextDiscount =
        promo.type === "percent" ? Math.round((total * promo.value) / 100) : promo.value;
      setDiscount(Math.min(nextDiscount, total));
    } catch {
      setDiscount(0);
      setPromoError("Промокод не найден или недействителен.");
    } finally {
      setValidating(false);
    }
  };

  return (
    <PageContainer>
      <div className="cart-overlay" onClick={() => navigate(-1)} />
      <motion.section
        className="cart-sheet"
        initial={{ y: 300, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 300, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120) {
            navigate(-1);
          }
        }}
      >
        <div className="sheet-header">
          <div className="sheet-handle" />
          <div className="sheet-title">
            <h2>Корзина</h2>
            <button className="button" onClick={() => navigate(-1)}>
              Закрыть
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            <p>Корзина пуста. Давайте начнём 👇</p>
            <Link className="button" to="/shop">
              В каталог
            </Link>
          </div>
        ) : (
          <>
            <ul className="cart-list">
              {items.map((item) => (
                <li key={item.itemId} className="cart-item">
                  <span>{item.name}</span>
                  <span>× {item.qty}</span>
                </li>
              ))}
            </ul>
            <div className="section">
              <label>Промокод</label>
              <div className="id-row">
                <input
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                  placeholder="Введите промокод"
                />
                <button className="button" onClick={handlePromo} disabled={validating}>
                  {validating ? "Проверяем..." : "Применить"}
                </button>
              </div>
              {promoError && <p className="hint">{promoError}</p>}
              {discount > 0 && <p className="hint">Скидка: {formatMoney(discount)}</p>}
            </div>
            <div className="total">{formatMoney(Math.max(total - discount, 0))}</div>
            <Link className="button primary" to="/checkout">
              Оформить
            </Link>
          </>
        )}
      </motion.section>
    </PageContainer>
  );
};
