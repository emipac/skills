/** Download the owner's static report as bytes; never mount its HTML in the dashboard. */
export const downloadReport = (html, { urls = URL, schedule = setTimeout } = {}) => {
  const url = urls.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'framework-report.html';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  schedule(() => urls.revokeObjectURL(url), 1000);
};
