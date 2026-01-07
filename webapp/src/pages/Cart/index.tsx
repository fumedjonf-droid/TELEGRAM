import { PageContainer } from "../../components/layout/PageContainer";
import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { Link } from "react-router-dom";

export const Cart = () => {
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.totalPrice());

  return (
    <PageContainer>
      <h2>Корзина</h2>
      {items.length === 0 ? (
        <p>Корзина пуста.</p>
      ) : (
        <>
          <ul className="cart-list">
            {items.map((item) => (
              <li key={item.itemId}>
                {item.name} × {item.qty}
              </li>
            ))}
          </ul>
          <div className="total">{formatMoney(total)}</div>
          <Link className="button primary" to="/checkout">
            Оформить
          </Link>
        </>
      )}
    </PageContainer>
  );
};
