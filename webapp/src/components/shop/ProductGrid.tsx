import { motion } from "framer-motion";
import { Item } from "../../api/items.api";
import { ProductCard } from "./ProductCard";

const container = {
  show: {
    transition: {
      staggerChildren: 0.05
    }
  }
};

const itemMotion = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 }
};

export const ProductGrid = ({ items }: { items: Item[] }) => (
  <motion.div className="grid" variants={container} initial="hidden" animate="show">
    {items.map((item) => (
      <motion.div key={item.id} variants={itemMotion}>
        <ProductCard item={item} />
      </motion.div>
    ))}
  </motion.div>
);
