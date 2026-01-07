import { motion } from "framer-motion";
import { Item } from "../../api/items.api";
import { formatMoney } from "../../utils/formatMoney";
import { useCartStore } from "../../store/cart.store";

export const ProductCard = ({ item }: { item: Item }) => {
  const addItem = useCartStore((state) => state.addItem);

  return (
    <motion.div className="card" whileTap={{ scale: 0.97 }}>
      <div className="card-image">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} loading="lazy" />
        ) : (
          <div className="image-fallback">Нет фото</div>
        )}
      </div>
      <div className="card-body">
        <div className="card-title">{item.name}</div>
        <div className="card-price">{formatMoney(item.price)}</div>
        <button
          className="button"
          onClick={() =>
            addItem({ itemId: item.id, name: item.name, price: item.price, imageUrl: item.imageUrl })
          }
        >
          Добавить
        </button>
      </div>
    </motion.div>
  );
};
