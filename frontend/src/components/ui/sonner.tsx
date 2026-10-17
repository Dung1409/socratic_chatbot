import { Toaster as Sonner } from "sonner";
import { useRouterState } from "@tanstack/react-router";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const learning = useRouterState({ select: (state) => state.location.pathname === "/phien-hoc" });
  return (
    <Sonner
      className={learning ? "learning-theme toaster group" : "toaster group"}
      position={learning ? "top-center" : "bottom-right"}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
