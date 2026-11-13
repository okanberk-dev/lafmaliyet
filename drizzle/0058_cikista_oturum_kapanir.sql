-- Çıkışta oturum sunucuda kapanır (denetim 13 Kasım 2026, YO-02): oturum çerezi rastgele bir kimlik (jti) taşır,
-- çıkışta bu kimlik buraya yazılır ve çerezin kopyası da artık geçmez; kişinin öteki cihazları etkilenmez. Yalnız yeni
-- tablo, eklemeli (eski kod ona dokunmaz). Şubeyle ilgisi yok, geri doldurulacak satır yok.
CREATE TABLE "revoked_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
