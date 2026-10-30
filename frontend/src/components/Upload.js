import React from "react";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadForm from "./UploadForm";

// Modal wrapper around UploadForm. `mode` is the X12 transaction type: "999" | "835" | "277".
export default function Upload({ open, onClose, mode, apiurl, user }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth>
      <DialogTitle>
        Upload File
        <IconButton
          onClick={onClose}
          aria-label="close"
          color="inherit"
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ paddingTop: 0, width: "100%" }}>
        <UploadForm apiurl={apiurl} user={user} mode={mode} />
      </DialogContent>
    </Dialog>
  );
}
