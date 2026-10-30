import React, { createContext, useCallback, useContext, useState } from "react";
import { Snackbar, Alert } from "@mui/material";

// Single app-wide Snackbar. Screens call `notify(message, severity)` instead of
// window.alert() or rolling their own message Modal.
export const FeedbackContext = createContext({ notify: () => {} });

export function useNotify() {
  return useContext(FeedbackContext).notify;
}

export default function FeedbackProvider({ children }) {
  const [toast, setToast] = useState({ open: false, message: "", severity: "info" });

  const notify = useCallback((message, severity = "info") => {
    setToast({ open: true, message, severity });
  }, []);

  const close = (event, reason) => {
    if (reason === "clickaway") return;
    setToast((prev) => ({ ...prev, open: false }));
  };

  return (
    <FeedbackContext.Provider value={{ notify }}>
      {children}
      <Snackbar
        open={toast.open}
        autoHideDuration={toast.severity === "error" ? 8000 : 4000}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert onClose={close} severity={toast.severity} variant="filled" sx={{ width: "100%" }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </FeedbackContext.Provider>
  );
}
