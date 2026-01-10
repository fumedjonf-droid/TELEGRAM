import { motion } from "framer-motion";

const steps = [
  { key: "WAIT_PAYMENT", label: "Заказ создан", color: "#facc15" },
  { key: "PROOF_SENT", label: "Чек загружен", color: "#fb923c" },
  { key: "REVIEW", label: "Проверка админом", color: "#38bdf8" },
  { key: "PAID", label: "Оплата подтверждена", color: "#22c55e" },
  { key: "REJECTED", label: "Отклонено", color: "#f87171" },
  { key: "DELIVERED", label: "Выполнено", color: "#16a34a" },
  { key: "CLOSED", label: "Закрыто", color: "#94a3b8" },
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
