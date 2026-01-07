import { createBrowserRouter, Outlet } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ShopHome } from "../pages/ShopHome";
import { ProductDetails } from "../pages/ProductDetails";
import { Cart } from "../pages/Cart";
import { Checkout } from "../pages/Checkout";
import { MyOrders } from "../pages/MyOrders";
import { OrderDetails } from "../pages/OrderDetails";
import { Support } from "../pages/Support";
import { NotFound } from "../pages/NotFound";

const AnimatedLayout = () => (
  <AnimatePresence mode="wait">
    <Outlet />
  </AnimatePresence>
);

export const router = createBrowserRouter([
  {
    element: <AnimatedLayout />,
    children: [
      { path: "/", element: <ShopHome /> },
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
