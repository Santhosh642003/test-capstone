import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import moment from "moment-timezone";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from './Feedback';

const formatDate = (value) =>
    moment(value).isValid() ? moment(value).tz("America/New_York").format("MM/DD/YYYY") : "-";

const dateColumn = (field, headerName) => ({
    field,
    headerName,
    flex: 1,
    valueFormatter: ({ value }) => formatDate(value),
});

// Most recent activity per company from GET /company2. Fields match the API response.
const columns = [
    { field: 'id', headerName: 'id', hide: true },
    {
        field: 'com_name',
        headerName: 'Company',
        flex: 2,
        renderCell: (params) => (
            <p className="text-wrap" style={{ lineHeight: 1 }}>{params.value}</p>
        ),
    },
    dateColumn('last_task', 'Task added'),
    dateColumn('last_artifacts', 'Document upload'),
    dateColumn('last_customer', 'Customer added'),
    dateColumn('last_timesheet', 'Timesheet entry'),
    dateColumn('last_claim', 'Claim submitted'),
];

const ACTIVITY_FIELDS = ['last_task', 'last_artifacts', 'last_customer', 'last_timesheet', 'last_claim'];
const hasActivity = (company) => ACTIVITY_FIELDS.some((field) => !!company[field]);

export default function LastDateOfActions({ apiurl }) {
    const notify = useNotify();
    const [companies, setCompanies] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        axios.get(`${apiurl}/company2`)
            .then(({ data }) => {
                if (!cancelled) setCompanies(data.company ?? []);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load last date of actions. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [apiurl, notify]);

    // Companies with no recorded activity sink to the bottom; otherwise API order is kept.
    const rows = useMemo(
        () => companies
            .map((company, index) => ({ ...company, id: index }))
            .sort((a, b) => Number(hasActivity(b)) - Number(hasActivity(a))),
        [companies]
    );

    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
                density="compact"
                rows={rows}
                columns={columns}
                showToolbar components={{ Toolbar: GridToolbar }}
                pageSize={10}
                loading={isLoading}
            />
        </div>
    );
}
