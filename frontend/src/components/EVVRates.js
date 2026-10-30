import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Box, Button, TextField, Typography } from "@mui/material";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from "./Feedback";

const DELIVERY_MODE_LABEL = `Delivery Mode ("I" or "G")`;

// Global EVV billing rates (table `billingrates`). Rows are edited inline; new rows via the form above the grid.
const columns = [
    { field: "billingrate_id", headerName: "ID", hide: true },
    { field: "procProcCode", headerName: "Procedure Code", flex: 1, editable: true },
    { field: "tier", headerName: "Tier", flex: 1, editable: true },
    { field: "deliveryMode", headerName: DELIVERY_MODE_LABEL, flex: 1, editable: true },
    { field: "procModifierCode", headerName: "Procedure Modifier Code", flex: 1, editable: true },
    {
        field: "rate",
        headerName: "Rate",
        flex: 0.5,
        editable: true,
        type: "number",
        align: "right",
        headerAlign: "left",
        valueFormatter: ({ value }) => (value == null ? "" : Number(value).toFixed(2)),
    },
];

const NEW_RATE_FIELDS = [
    { name: "procProcCode", label: "Procedure Proc Code" },
    { name: "procModifierCode", label: "Procedure Modifier Code" },
    { name: "tier", label: "Tier" },
    { name: "deliveryMode", label: DELIVERY_MODE_LABEL },
    { name: "rate", label: "Rate", type: "number", inputProps: { step: "0.01" } },
];

const EMPTY_RATE = { procProcCode: "", procModifierCode: "", tier: "", deliveryMode: "", rate: "" };

export default function EVVRates({ apiurl }) {
    const notify = useNotify();
    const [billingRates, setBillingRates] = useState([]);
    const [newRate, setNewRate] = useState(EMPTY_RATE);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const fetchRates = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data } = await axios.get(`${apiurl}/evv/rates`);
            setBillingRates(data);
        } catch (err) {
            console.error(err);
            notify("Failed to load EVV rates. Check the browser log for details.", "error");
        } finally {
            setIsLoading(false);
        }
    }, [apiurl, notify]);

    useEffect(() => {
        fetchRates();
    }, [fetchRates]);

    // Rejecting here leaves the row in edit mode and triggers onProcessRowUpdateError.
    const processRowUpdate = async (newRow) => {
        await axios.put(`${apiurl}/evv/rates`, newRow);
        return newRow;
    };

    const handleAddRate = async () => {
        setIsSaving(true);
        try {
            await axios.post(`${apiurl}/evv/rates`, { ...newRate, rate: Number(newRate.rate) });
            notify("New rate added successfully", "success");
            setNewRate(EMPTY_RATE);
            await fetchRates();
        } catch (err) {
            console.error(err);
            notify("Failed to add rate. Check the browser log for details.", "error");
        } finally {
            setIsSaving(false);
        }
    };

    // rate is interpolated unquoted into the INSERT, so an empty value is a SQL error server-side
    const canAdd = newRate.procProcCode.trim() !== "" && newRate.rate !== "";

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 8px 0" }}>
            <Typography variant="h6" gutterBottom>
                List of Global EVV Rates (Editable)
            </Typography>

            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", mb: 2 }}>
                {NEW_RATE_FIELDS.map(({ name, label, ...fieldProps }) => (
                    <TextField
                        key={name}
                        size="small"
                        label={label}
                        value={newRate[name]}
                        onChange={(e) => setNewRate((prev) => ({ ...prev, [name]: e.target.value }))}
                        {...fieldProps}
                    />
                ))}
                <Button variant="contained" onClick={handleAddRate} disabled={!canAdd || isSaving}>
                    Add New Rate
                </Button>
            </Box>

            <div style={{ flex: 1, minHeight: 0 }}>
                <DataGridPro
                    density="compact"
                    rows={billingRates}
                    getRowId={(row) => row.billingrate_id}
                    columns={columns}
                    processRowUpdate={processRowUpdate}
                    onProcessRowUpdateError={(err) => {
                        console.error(err);
                        notify("Failed to update rate. Check the browser log for details.", "error");
                    }}
                    experimentalFeatures={{ newEditingApi: true }}
                    showToolbar
                    components={{ Toolbar: GridToolbar }}
                    loading={isLoading}
                />
            </div>
        </div>
    );
}
