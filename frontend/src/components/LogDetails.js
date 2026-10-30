import React, { useEffect, useState } from "react";
import axios from "axios";
import moment from "moment-timezone";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from './Feedback';

const PAGE_SIZE = 1000;

const formatDateTime = (value) =>
    moment(value).isValid() ? moment(value).tz("America/New_York").format("MM/DD/YYYY HH:mm:ss") : "";

// fw_log rows, newest first. Paged server-side via GET /log?limit&offset.
const columns = [
    { field: 'company_id', headerName: 'Company ID', flex: 1 },
    { field: 'employee_id', headerName: 'Employee ID', flex: 1 },
    { field: 'action_type', headerName: 'Action type', flex: 3 },
    { field: 'action_subtype', headerName: 'Action subtype', flex: 3 },
    { field: 'action_detail', headerName: 'Action detail', flex: 3 },
    {
        field: 'systime',
        headerName: 'Timestamp',
        flex: 2,
        valueFormatter: ({ value }) => formatDateTime(value),
    },
    { field: 'sessionid', headerName: 'Session Id', flex: 3 },
];

export default function LogDetails({ apiurl }) {
    const notify = useNotify();
    const [rows, setRows] = useState([]);
    const [rowCount, setRowCount] = useState(0);
    const [page, setPage] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        axios.get(`${apiurl}/log`, { params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } })
            .then(({ data }) => {
                if (cancelled) return;
                setRows(data.log ?? []);
                setRowCount(data.totalRows ?? 0);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load logs. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [apiurl, page, notify]);

    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
                density="compact"
                rows={rows}
                getRowId={(row) => row.fw_log_id}
                columns={columns}
                showToolbar components={{ Toolbar: GridToolbar }}
                initialState={{ sorting: { sortModel: [{ field: 'systime', sort: 'desc' }] } }}
                pagination
                paginationMode="server"
                rowCount={rowCount}
                page={page}
                onPageChange={setPage}
                pageSize={PAGE_SIZE}
                rowsPerPageOptions={[PAGE_SIZE]}
                loading={isLoading}
            />
        </div>
    );
}
