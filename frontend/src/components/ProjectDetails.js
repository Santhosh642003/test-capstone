import React, { useEffect, useState } from "react";
import axios from "axios";
import moment from "moment-timezone";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from './Feedback';

const formatDate = (value) =>
    moment(value).isValid() ? moment(value).tz("America/New_York").format("MM/DD/YYYY") : "";

const dateColumn = (field, headerName) => ({
    field,
    headerName,
    flex: 1,
    valueFormatter: ({ value }) => formatDate(value),
});

// One row per project with task/artifact/MT counts, from GET /project. Fields match the API response.
const columns = [
    { field: 'pro_id', headerName: 'Project ID', flex: 1, hide: true },
    { field: 'com_id', headerName: 'Company ID', flex: 1, hide: true },
    { field: 'com_name', headerName: 'Company', flex: 1 },
    { field: 'pro_title', headerName: 'Projects', flex: 2 },
    dateColumn('pro_starts_on', 'Start Date'),
    dateColumn('pro_ends_on', 'End Date'),
    { field: 'empAssoc', headerName: 'Emp Associated', flex: 1 },
    { field: 'activeTasks_num', headerName: 'Active tasks', flex: 1 },
    { field: 'completedTasks_num', headerName: 'Completed tasks', flex: 1 },
    { field: 'artifacts', headerName: 'Artifacts', flex: 1 },
    { field: 'mts', headerName: 'MTs', flex: 1 },
];

export default function ProjectDetails({ apiurl }) {
    const notify = useNotify();
    const [projects, setProjects] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        axios.get(`${apiurl}/project`)
            .then(({ data }) => {
                if (!cancelled) setProjects(data.project ?? []);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load project details. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [apiurl, notify]);

    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
                density="compact"
                rows={projects}
                getRowId={(row) => row.pro_id}
                columns={columns}
                showToolbar components={{ Toolbar: GridToolbar }}
                initialState={{ sorting: { sortModel: [{ field: "com_id", sort: "asc" }] } }}
                loading={isLoading}
            />
        </div>
    );
}
