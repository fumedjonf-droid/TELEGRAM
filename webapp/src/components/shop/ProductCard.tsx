import { motion } from "framer-motion";
import { Item } from "../../api/items.api";
import { formatMoney } from "../../utils/formatMoney";
import { useCartStore } from "../../store/cart.store";

export const ProductCard = ({ item }: { item: Item }) => {
  const addItem = useCartStore((state) => state.addItem);
  const items = useCartStore((state) => state.items);
  const selected = items.some((entry) => entry.itemId === item.id);

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
        <div className="card-description">{item.description ?? "Популярный товар"}</div>
        <div className="card-price">{formatMoney(item.price)}</div>
        {item.promoEndAt && (
          <div className="card-description">Акция до {new Date(item.promoEndAt).toLocaleString()}</div>
        )}
        <button
          className={`button ${selected ? "primary" : ""}`}
          onClick={() =>
            addItem({ itemId: item.id, name: item.name, price: item.price, imageUrl: item.imageUrl })
          }
        >
          {selected ? "Выбрано" : "Выбрать"}
        </button>
      </div>
    </motion.div>
  );
};
