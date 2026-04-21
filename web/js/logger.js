// Continuous log and measurement point log - CSV export

function downloadCSV(filename, headerArr, rowsArr) {
    const BOM = "﻿";
    const lines = [headerArr.join(",")];
    for (const row of rowsArr) {
        lines.push(row.join(","));
    }
    const content = BOM + lines.join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function formatTimestampForFilename(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
           `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}
