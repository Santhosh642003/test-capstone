const handleCatchError = (error, res) => {
  const statusCode = error?.status || 500
  const errorMessage = error?.message || 'Something went wrong!'

  return res.status(statusCode).json({ success: false, message: errorMessage })
}

module.exports = {
  handleCatchError
}
