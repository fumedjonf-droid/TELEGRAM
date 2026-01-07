import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { Link } from "react-router-dom";

export const BottomCartBar = () => {
  const totalPrice = useCartStore((state) => state.totalPrice());
  const totalQty = useCartStore((state) => state.totalQty());

  if (totalQty === 0) {
    return null;
  }

  return (
    <div className="bottom-cart-bar">
      <div>
        <div className="bottom-cart-title">В корзине: {totalQty}</div>
        <div className="bottom-cart-total">{formatMoney(totalPrice)}</div>
      </div>
      <Link className="button primary" to="/cart">
        В корзину
      </Link>
    </div>
  );
};
