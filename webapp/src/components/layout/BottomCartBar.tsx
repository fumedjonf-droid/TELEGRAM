import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

export const BottomCartBar = () => {
  const totalPrice = useCartStore((state) => state.totalPrice());
  const totalQty = useCartStore((state) => state.totalQty());

  if (totalQty === 0) {
    return null;
  }

  return (
    <div className="bottom-cart-bar">
      <div>
        <div className="bottom-cart-title">
          В корзине:{" "}
          <motion.span
            key={totalQty}
            className="cart-badge"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
          >
            {totalQty}
          </motion.span>
        </div>
        <div className="bottom-cart-total">{formatMoney(totalPrice)}</div>
      </div>
      <Link className="button primary" to="/cart">
        В корзину
      </Link>
    </div>
  );
};
