import React, { useMemo, useState } from 'react';
import { Box, CircularProgress } from "@mui/material";
import jwt from "jsonwebtoken";

// Signed Metabase dashboard embed. `dashboardId` is the Metabase dashboard number,
// `params` are the dashboard's locked filter values.
export default function MetabaseDashboard({ dashboardId, params = {} }) {
    const [isIframeLoading, setIsIframeLoading] = useState(true);

    const handleIframeLoad = () => {
        setIsIframeLoading(false);
    };

    const METABASE_SITE_URL = "https://reportingserver-eteyfkh8g0f2ctag.eastus-01.azurewebsites.net";
    const METABASE_SECRET_KEY = "09b116eed635e37cc1e2a0e105bb709460085427f4861efb1edbbec872fc660b";

    // Memoise on the serialised params rather than the object: the parent rebuilds
    // its nav array on every render, so the object identity changes even when the
    // values don't. Re-signing would change the iframe src and reload the dashboard.
    const paramsKey = JSON.stringify(params);
    const iframeUrl = useMemo(() => {
        const payload = {
            resource: { dashboard: dashboardId },
            params: JSON.parse(paramsKey),
            exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
        };
        const token = jwt.sign(payload, METABASE_SECRET_KEY);

        return METABASE_SITE_URL + "/embed/dashboard/" + token +
            "#background=false&bordered=false&titled=false";
    }, [dashboardId, paramsKey]);

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {isIframeLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                    <CircularProgress />
                </Box>
            )}
            <iframe
                src={iframeUrl}
                style={{ flex: 1, width: '100%', border: 'none' }}
                allowTransparency
                onLoad={handleIframeLoad}
            />
        </div>
    );
}
