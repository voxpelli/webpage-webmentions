-- ----------------------------
--  Table structure for entries
-- ----------------------------
DROP TABLE IF EXISTS "public"."entries";
CREATE TABLE "public"."entries" (
	"url" varchar NOT NULL COLLATE "default",
	"data" json NOT NULL,
	"id" SERIAL NOT NULL,
	"raw" json
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for mentions
-- ----------------------------
DROP TABLE IF EXISTS "public"."mentions";
CREATE TABLE "public"."mentions" (
	"eid" int4 NOT NULL,
	"url" varchar NOT NULL COLLATE "default"
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Primary key structure for table entries
-- ----------------------------
ALTER TABLE "public"."entries" ADD CONSTRAINT "entries_pkey" PRIMARY KEY ("url") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------
--  Uniques structure for table entries
-- ----------------------------
ALTER TABLE "public"."entries" ADD CONSTRAINT "entries_id_key" UNIQUE ("id") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------
--  Indexes structure for table entries
-- ----------------------------
CREATE UNIQUE INDEX  "entries_id_key" ON "public"."entries" USING btree("id" ASC NULLS LAST);

-- ----------------------------
--  Primary key structure for table mentions
-- ----------------------------
ALTER TABLE "public"."mentions" ADD CONSTRAINT "mentions_pkey" PRIMARY KEY ("eid", "url") NOT DEFERRABLE INITIALLY IMMEDIATE;

