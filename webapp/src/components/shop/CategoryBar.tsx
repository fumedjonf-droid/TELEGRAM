export const CategoryBar = ({
  categories,
  activeId,
  onChange
}: {
  categories: { id: number; name: string }[];
  activeId?: number;
  onChange: (id?: number) => void;
}) => (
  <div className="category-bar">
    {categories.map((category) => (
      <button
        key={category.id}
        className={`category-pill ${activeId === category.id ? "active" : ""}`}
        onClick={() => onChange(category.id)}
      >
        {category.name}
      </button>
    ))}
  </div>
);
