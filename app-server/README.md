# App / session storage server
#
# Run (recommended for drafts + FTS library + output archive):
#   ./start-with-app.sh
#
# Endpoints (default http://127.0.0.1:8080):
#   GET  /api/health
#   PUT  /api/temp/{id}     autosave draft JSON
#   GET  /api/temp/{id}
#   DELETE /api/temp/{id}
#   GET  /api/fts           recent + all saved sessions
#   POST /api/fts           { name, document, tempId? }
#   GET  /api/fts/{id}
#   POST /api/output        multipart PNG → output/
#   GET  /api/output
#
# Directories (contents gitignored; folders tracked):
#   ../temp    working drafts
#   ../fts     named saved sessions
#   ../output  PNG export archive
