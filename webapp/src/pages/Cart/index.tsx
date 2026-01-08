import { PageContainer } from "../../components/layout/PageContainer";
import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

export const Cart = () => {
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.totalPrice());
  const navigate = useNavigate();

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
            <div className="total">{formatMoney(total)}</div>
            <Link className="button primary" to="/checkout">
              Оформить
            </Link>
          </>
        )}
      </motion.section>
    </PageContainer>
  );
};
