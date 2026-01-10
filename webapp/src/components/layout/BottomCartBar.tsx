import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

export const BottomCartBar = () => {
  const totalPrice = useCartStore((state) => state.totalPrice());
  const totalQty = useCartStore((state) => state.totalQty());
  const items = useCartStore((state) => state.items);

  if (totalQty === 0) {
    return null;
  }
  const first = items[0];
  const title = first ? `Купить ${first.name} за ${formatMoney(totalPrice)}` : `Купить за ${formatMoney(totalPrice)}`;

  return (
    <motion.div
      className="bottom-cart-bar"
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div>
        <div className="bottom-cart-title">
          {title}{" "}
          <motion.span
            key={totalQty}
            className="cart-badge"
            initial={{ scale: 0.9 }}
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {totalQty}
          </motion.span>
        </div>
        <div className="bottom-cart-total">{formatMoney(totalPrice)}</div>
      </div>
      <Link className="button primary" to="/cart">
        В корзину
      </Link>
    </motion.div>
  );
};
