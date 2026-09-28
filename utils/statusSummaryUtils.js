const statusValues = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const applyStatusFilter = (filter, field, value) => {
  const values = statusValues(value);
  if (values.length === 1) filter[field] = values[0];
  if (values.length > 1) filter[field] = { $in: values };
  return filter;
};

const countsFromRows = (rows = []) => Object.fromEntries(
  rows
    .filter((row) => row?._id !== null && row?._id !== undefined)
    .map((row) => [String(row._id), Number(row.count) || 0]),
);

const summarizeStatusFields = async (Model, filter = {}, fields = ['status']) => {
  const facets = {
    total: [{ $count: 'count' }],
  };

  fields.forEach((field) => {
    facets[`${field}Counts`] = [
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ];
  });

  const [result = {}] = await Model.aggregate([
    { $match: filter },
    { $facet: facets },
  ]);

  const summary = {
    total: Number(result.total?.[0]?.count) || 0,
  };
  fields.forEach((field) => {
    summary[`${field}Counts`] = countsFromRows(result[`${field}Counts`]);
  });
  return summary;
};

module.exports = {
  applyStatusFilter,
  countsFromRows,
  statusValues,
  summarizeStatusFields,
};
