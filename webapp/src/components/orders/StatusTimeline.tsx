import { motion } from "framer-motion";

const steps = [
  { key: "pending", label: "Заказ создан", color: "#facc15" },
  { key: "awaiting_proof", label: "Ожидаем чек", color: "#fb923c" },
  { key: "paid_review", label: "Проверка админом", color: "#38bdf8" },
  { key: "approved", label: "Оплата подтверждена", color: "#22c55e" },
  { key: "completed", label: "Выполнено", color: "#16a34a" },
];

export const StatusTimeline = ({ status }: { status: string }) => {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.key === status));

  return (
    <div className="timeline">
      {steps.map((step, index) => (
        <div key={step.key} className="timeline-row">
          <motion.span
            className={`timeline-dot ${index <= currentIndex ? "active" : ""}`}
            style={{ backgroundColor: index <= currentIndex ? step.color : "#e2e8f0" }}
            layoutId={`dot-${step.key}`}
          />
          <span className={`timeline-label ${index <= currentIndex ? "active" : ""}`}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
};
