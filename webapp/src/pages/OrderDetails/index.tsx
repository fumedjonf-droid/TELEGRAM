import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "../../components/layout/PageContainer";
import { StatusTimeline } from "../../components/orders/StatusTimeline";
import { fetchOrderDetails } from "../../api/orders.api";
import { SkeletonCard } from "../../components/common/SkeletonCard";

export const OrderDetails = () => {
  const { id } = useParams();
  const orderId = Number(id);
  const { data: order, isLoading } = useQuery({
    queryKey: ["orders", orderId],
    queryFn: () => fetchOrderDetails(orderId),
    enabled: Number.isFinite(orderId),
  });

  return (
    <PageContainer>
      <h2>Детали заказа</h2>
      {isLoading || !order ? (
        <SkeletonCard />
      ) : (
        <>
          <StatusTimeline status={order.status} />
          <div className="section">
            <div>Заказ #{order.id}</div>
            <div>Сумма: {order.totalAmount}</div>
            <div>Оплата: {order.paymentMethod}</div>
            <div>Игровой ID: {order.gameId}</div>
            {order.proofPath && <div>Чек загружен</div>}
          </div>
          <div className="section">
            <h3>Состав</h3>
            <ul>
              {order.items.map((item) => (
                <li key={item.name}>
                  {item.name} × {item.qty}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </PageContainer>
  );
};
