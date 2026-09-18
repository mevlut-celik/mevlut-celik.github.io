CREATE TABLE IF NOT EXISTS kayit (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT    NOT NULL UNIQUE,
  ad_soyad       TEXT    NOT NULL,
  eposta         TEXT    NOT NULL,
  kurum          TEXT    NOT NULL,
  unvan          TEXT    NOT NULL DEFAULT '',
  kategori       TEXT    NOT NULL,
  bildiri_no     TEXT    NOT NULL DEFAULT '',
  fatura_tipi    TEXT    NOT NULL DEFAULT 'bireysel',
  fatura_unvan   TEXT    NOT NULL DEFAULT '',
  vergi_dairesi  TEXT    NOT NULL DEFAULT '',
  vergi_no       TEXT    NOT NULL DEFAULT '',
  not_metni      TEXT    NOT NULL DEFAULT '',
  kvkk_onay      INTEGER NOT NULL DEFAULT 0,
  durum          TEXT    NOT NULL DEFAULT 'on_kayit',
  dil            TEXT    NOT NULL DEFAULT 'tr',
  ip_hash        TEXT    NOT NULL DEFAULT '',
  olusturma      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS kayit_eposta ON kayit (eposta);
CREATE INDEX IF NOT EXISTS kayit_olusturma ON kayit (olusturma);

CREATE TABLE IF NOT EXISTS istek_gunlugu (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash   TEXT NOT NULL,
  olusturma TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS istek_ip ON istek_gunlugu (ip_hash, olusturma);
