<?php
/** Düz metin e-posta (UTF-8). Paylaşımlı hostingde mail() genelde çalışır;
 *  çalışmazsa 'enabled' => false yapıp kayıtları CSV ile takip edin. */

function siu_mail(array $cfg, string $kime, string $konu, string $govde): bool {
    if (empty($cfg['mail']['enabled'])) return false;
    $from     = $cfg['mail']['from'];
    $fromName = $cfg['mail']['from_name'];

    $basliklar = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: ' . mb_encode_mimeheader($fromName, 'UTF-8') . ' <' . $from . '>',
        'Reply-To: ' . $cfg['mail']['secretariat'],
        'X-Mailer: SIU2027',
    ];
    if (!empty($cfg['mail']['bcc'])) $basliklar[] = 'Bcc: ' . $cfg['mail']['bcc'];

    return @mail(
        $kime,
        mb_encode_mimeheader($konu, 'UTF-8'),
        $govde,
        implode("\r\n", $basliklar),
        '-f' . $from
    );
}

function siu_katilimci_metni(array $k, array $cfg, array $sozluk): string {
    $odeme = $cfg['payment']['mode'] === 'none'
        ? $sozluk['odeme_yok']
        : str_replace('{url}', $cfg['payment']['url'] . '?ref=' . rawurlencode($k['ref']), $sozluk['odeme_var']);

    return implode("\n", [
        $sozluk['selam'] . ' ' . $k['ad_soyad'] . ',',
        '',
        $sozluk['giris'],
        '',
        $sozluk['ref'] . ': ' . $k['ref'],
        $sozluk['kategori'] . ': ' . $k['kategori_etiket'],
        $sozluk['kurum'] . ': ' . $k['kurum'],
        ($k['bildiri_no'] !== '' ? $sozluk['bildiri'] . ': ' . $k['bildiri_no'] : ''),
        '',
        $odeme,
        '',
        $sozluk['iletisim'],
        '',
        '— ' . $cfg['mail']['from_name'],
        $cfg['site']['url'],
    ]);
}
