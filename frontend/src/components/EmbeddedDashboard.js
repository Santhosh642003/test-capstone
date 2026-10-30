import React from "react";

// Plain iframe embed for third-party dashboards (Amplitude share links etc.)
export default function EmbeddedDashboard({ src }) {
    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <iframe
                src={src}
                style={{ flex: 1, width: '100%', border: 'none' }}
            />
        </div>
    );
}
