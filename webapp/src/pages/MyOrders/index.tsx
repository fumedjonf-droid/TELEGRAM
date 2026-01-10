import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "../../components/layout/PageContainer";
import { fetchMyOrders } from "../../api/orders.api";
import { SkeletonCard } from "../../components/common/SkeletonCard";

export const MyOrders = () => {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders", "my"],
    queryFn: fetchMyOrders,
  });

  return (
    <PageContainer>
      <h2>Мои заказы</h2>
      {isLoading ? (
        <SkeletonCard />
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <p>У вас пока нет заказов. Давайте начнём 👇</p>
          <Link className="button" to="/shop">
            В каталог
          </Link>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <Link key={order.id} className="order-card" to={`/orders/${order.id}`}>
              <div>Заказ #{order.id}</div>
              <div className="order-status">{order.status}</div>
              <div className="order-date">{new Date(order.createdAt).toLocaleString()}</div>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
};
