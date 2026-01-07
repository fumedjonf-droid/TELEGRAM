import { Category } from "../../api/items.api";

export const CategoryBar = ({
  categories,
  activeId,
  onChange
}: {
  categories: Category[];
  activeId?: number;
  onChange: (id?: number) => void;
}) => (
  <div className="category-bar">
    <button
      className={`category-pill ${activeId === undefined ? "active" : ""}`}
      onClick={() => onChange(undefined)}
    >
      Все
    </button>
    {categories.map((category) => (
      <button
        key={category.id}
        className={`category-pill ${activeId === category.id ? "active" : ""}`}
        onClick={() => onChange(category.id)}
      >
        {category.iconUrl ? <img src={category.iconUrl} alt="" /> : null}
        {category.name}
      </button>
    ))}
  </div>
);
