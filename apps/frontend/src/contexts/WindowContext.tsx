import React, { createContext, useContext, useState, useCallback } from 'react';

// Define the shape of your context
type WindowContextType = {
  demoWindow: Window | null;
  isWindowOpen: boolean;
  openWindow: (url: string) => void;
  closeWindow: () => void;
};

// Create the context with an initial value of `null`
const WindowContext = createContext<WindowContextType | undefined>(undefined);

// Custom hook to access the context
export const useWindowContext = () => {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error('useWindowContext must be used within a WindowProvider');
  }
  return context;
};

// Provider component
export const WindowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [demoWindow, setDemoWindow] = useState<Window | null>(null);
  const [isWindowOpen, setIsWindowOpen] = useState(false);

  const openWindow = useCallback(
    (url: string) => {
      const windowFeatures = 'noopener,left=50,top=50,width=1000,height=800';

      // Close existing window if it's already open
      if (demoWindow && !demoWindow.closed) {
        demoWindow.close();
      }

      // Open a new window and store the reference
      const newWindow = window.open(url, 'demoWindow', windowFeatures);
      setDemoWindow(newWindow);
      setIsWindowOpen(true);
    },
    [demoWindow],
  );

  const closeWindow = useCallback(() => {
    if (demoWindow && !demoWindow.closed) {
      demoWindow.close();
    }
    setDemoWindow(null);
    setIsWindowOpen(false);
  }, [demoWindow]);

  return (
    <WindowContext.Provider
      value={{ demoWindow, isWindowOpen, openWindow, closeWindow }}
    >
      {children}
    </WindowContext.Provider>
  );
};
