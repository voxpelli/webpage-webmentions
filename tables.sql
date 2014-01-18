-- ----------------------------
--  Table structure for accounts
-- ----------------------------
DROP TABLE IF EXISTS "public"."accounts";
CREATE TABLE "public"."accounts" (
	"id" serial NOT NULL,
	"service" varchar NOT NULL COLLATE "default",
	"external_id" varchar NOT NULL COLLATE "default",
	"created" timestamp(6) NOT NULL DEFAULT now(),
	"lastlogin" timestamp(6) NOT NULL DEFAULT now(),
	"username" varchar COLLATE "default"
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for entries
-- ----------------------------
DROP TABLE IF EXISTS "public"."entries";
CREATE TABLE "public"."entries" (
	"url" varchar NOT NULL COLLATE "default",
	"data" json NOT NULL,
	"id" serial NOT NULL,
	"raw" json
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for mentions
-- ----------------------------
DROP TABLE IF EXISTS "public"."mentions";
CREATE TABLE "public"."mentions" (
	"eid" int4 NOT NULL,
	"url" varchar NOT NULL COLLATE "default",
	"hostname" varchar NOT NULL COLLATE "default"
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for sites
-- ----------------------------
DROP TABLE IF EXISTS "public"."sites";
CREATE TABLE "public"."sites" (
	"aid" int4 NOT NULL,
	"hostname" varchar NOT NULL COLLATE "default",
	"created" timestamp(6) NOT NULL DEFAULT now(),
	"lastmention" timestamp(6) NULL
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Primary key structure for table accounts
-- ----------------------------
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id") NOT DEFERRABLE INITIALLY IMMEDIATE;

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

-- ----------------------------
--  Primary key structure for table sites
-- ----------------------------
ALTER TABLE "public"."sites" ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("hostname") NOT DEFERRABLE INITIALLY IMMEDIATE;

