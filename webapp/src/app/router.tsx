import { createBrowserRouter, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Welcome } from "../pages/Welcome";
import { ShopHome } from "../pages/ShopHome";
import { ProductDetails } from "../pages/ProductDetails";
import { Cart } from "../pages/Cart";
import { Checkout } from "../pages/Checkout";
import { MyOrders } from "../pages/MyOrders";
import { OrderDetails } from "../pages/OrderDetails";
import { Support } from "../pages/Support";
import { NotFound } from "../pages/NotFound";

const AnimatedLayout = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <div key={location.pathname}>
        <Outlet />
      </div>
    </AnimatePresence>
  );
};

export const router = createBrowserRouter([
  {
    element: <AnimatedLayout />,
    children: [
      { path: "/", element: <Welcome /> },
      { path: "/shop", element: <ShopHome /> },
      { path: "/product/:id", element: <ProductDetails /> },
      { path: "/cart", element: <Cart /> },
      { path: "/checkout", element: <Checkout /> },
      { path: "/orders", element: <MyOrders /> },
      { path: "/orders/:id", element: <OrderDetails /> },
      { path: "/support", element: <Support /> },
      { path: "*", element: <NotFound /> }
    ]
  }
]);
