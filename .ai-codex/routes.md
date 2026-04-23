# API Routes (generated 2026-04-19)
# 11 routes total.

## assets
GET          /api/assets
PUT,DELETE   /api/assets/:id [db]

## config
GET          /api/config

## ecco
POST         /api/ecco/generate [cache]
GET          /api/ecco/jobs/:jobId

## generate
POST         /api/generate [cache]

## generated
GET          /api/generated/:filename [cache]

## pudding
POST         /api/pudding/generate [cache]

## supabase
POST         /api/supabase/export

## upload
POST         /api/upload [db]

## uploads
GET          /api/uploads/:filename [cache]
