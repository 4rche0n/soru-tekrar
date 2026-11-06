/* Hazır ders / konu / kaynak kataloğu (TYT–AYT). Kullanıcı kendi eklediklerini meta deposunda tutar. */
(function (global) {
  const GEO_TYT = ['Doğruda ve Üçgende Açılar', 'Özel Üçgenler', 'Açıortay ve Kenarortay', 'Üçgende Alan', 'Üçgende Benzerlik', 'Çokgenler', 'Dörtgenler', 'Çember ve Daire', 'Analitik Geometri', 'Katı Cisimler'];
  const GEO_AYT = ['Analitik Geometri (Doğru)', 'Çemberin Analitik İncelenmesi', 'Dönüşüm Geometrisi', 'Katı Cisimler', 'Çember ve Daire'];

  const DERSLER = [
    { id: 'TYT Matematik', konular: ['Temel Kavramlar', 'Tek - Çift Sayılar', 'Pozitif - Negatif Sayılar', 'Ardışık Sayılar', 'Faktöriyel', 'Asal Sayılar ve Asal Çarpanlarına Ayırma', 'Sayılar', 'Basamak Kavramı', 'Bölme - Bölünebilme', 'Ebob - Ekok', 'Periyodik Problemler', 'Rasyonel Sayılar', 'Ondalık Sayılar', '1. Dereceden Denklemler', 'Basit Eşitsizlikler', 'Mutlak Değer', 'Üslü Sayılar', 'Köklü Sayılar', 'Çarpanlara Ayırma', 'Oran - Orantı', 'Sayı Problemleri', 'Kesir Problemleri', 'Yaş Problemleri', 'İşçi Problemleri', 'Yüzde Problemleri', 'Kâr - Zarar Problemleri', 'Yüzde ve Kâr - Zarar Problemleri', 'Karışım Problemleri', 'Hız Problemleri', 'Grafik Problemleri', 'Mantık', 'Kümeler ve Kartezyen Çarpımı', 'Fonksiyonlar', 'Polinomlar', '2. Dereceden Denklemler', 'Sayma - Permütasyon - Kombinasyon', 'Binom', 'Olasılık', 'Veri Analizi ve Grafikler', ...GEO_TYT] },
    { id: 'TYT Fizik', konular: ['Fizik Bilimine Giriş', 'Madde ve Özellikleri', 'Hareket ve Kuvvet', 'İş, Güç ve Enerji', 'Isı, Sıcaklık ve Genleşme', 'Basınç', 'Kaldırma Kuvveti', 'Elektrostatik', 'Elektrik Akımı ve Devreler', 'Manyetizma', 'Dalgalar', 'Optik'] },
    { id: 'TYT Kimya', konular: ['Kimya Bilimi', 'Atom ve Periyodik Sistem', 'Kimyasal Türler Arası Etkileşimler', 'Maddenin Halleri', 'Doğa ve Kimya', 'Kimyanın Temel Kanunları', 'Mol Kavramı', 'Kimyasal Tepkimeler ve Hesaplamalar', 'Karışımlar', 'Asitler, Bazlar ve Tuzlar', 'Kimya Her Yerde'] },
    { id: 'TYT Biyoloji', konular: ['Canlıların Ortak Özellikleri', 'Canlıların Temel Bileşenleri', 'Hücre ve Organelleri', 'Hücre Zarından Madde Geçişi', 'Canlıların Sınıflandırılması', 'Hücre Bölünmeleri (Mitoz - Mayoz)', 'Eşeyli ve Eşeysiz Üreme', 'Kalıtım', 'Ekosistem Ekolojisi', 'Güncel Çevre Sorunları'] },
    { id: 'TYT Türkçe', konular: ['Sözcükte Anlam', 'Cümlede Anlam', 'Paragraf', 'Ses Bilgisi', 'Yazım Kuralları', 'Noktalama İşaretleri', 'Sözcükte Yapı', 'İsim ve Sıfat', 'Zamir', 'Zarf', 'Edat, Bağlaç, Ünlem', 'Fiil, Ek Fiil', 'Fiilimsi', 'Fiilde Çatı', 'Cümlenin Ögeleri', 'Cümle Türleri', 'Anlatım Bozuklukları'] },
    { id: 'TYT Tarih', konular: ['Tarih ve Zaman', 'İnsanlığın İlk Dönemleri', 'Orta Çağ\'da Dünya', 'İlk ve Orta Çağlarda Türk Dünyası', 'İslam Medeniyetinin Doğuşu', 'İlk Türk-İslam Devletleri', 'Selçuklu Türkiyesi', 'Beylikten Devlete Osmanlı', 'Dünya Gücü Osmanlı', 'Osmanlı Kültür ve Medeniyeti', 'Değişim Çağında Avrupa ve Osmanlı', 'Uluslararası İlişkilerde Denge Stratejisi (1774-1914)', 'Devrimler Çağında Devlet-Toplum İlişkileri', 'XX. Yüzyıl Başlarında Osmanlı ve Dünya', 'Milli Mücadele', 'Atatürkçülük ve Türk İnkılabı'] },
    { id: 'TYT Coğrafya', konular: ['Doğa ve İnsan', 'Dünya\'nın Şekli ve Hareketleri', 'Coğrafi Konum', 'Harita Bilgisi', 'Atmosfer ve Sıcaklık', 'Basınç ve Rüzgârlar', 'Nem ve Yağış', 'İklim Tipleri', 'İç ve Dış Kuvvetler', 'Su, Toprak ve Bitki', 'Nüfus', 'Göç', 'Yerleşme', 'Ekonomik Faaliyetler', 'Bölgeler', 'Ulaşım Yolları', 'Doğal Afetler', 'Çevre ve Toplum'] },
    { id: 'AYT Matematik', konular: ['Fonksiyonlar', 'Polinomlar', '2. Dereceden Denklemler', 'Karmaşık Sayılar', 'Parabol', 'Eşitsizlikler', 'Logaritma', 'Diziler', 'Trigonometri', 'Limit ve Süreklilik', 'Türev', 'İntegral', 'Permütasyon - Kombinasyon - Olasılık', ...GEO_AYT] },
    { id: 'AYT Fizik', konular: ['Vektörler', 'Bağıl Hareket', 'Newton\'un Hareket Yasaları', 'Bir Boyutta Sabit İvmeli Hareket', 'Atışlar (İki Boyutta Hareket)', 'Enerji ve Hareket', 'İtme ve Momentum', 'Tork ve Denge', 'Kütle Merkezi', 'Basit Makineler', 'Elektriksel Kuvvet ve Alan', 'Elektriksel Potansiyel', 'Düzgün Elektrik Alan ve Sığa', 'Manyetik Alan ve Kuvvet', 'İndüksiyon', 'Alternatif Akım ve Transformatörler', 'Çembersel Hareket', 'Basit Harmonik Hareket', 'Dalga Mekaniği', 'Atom Fiziği ve Radyoaktivite', 'Modern Fizik', 'Modern Fiziğin Teknolojideki Uygulamaları'] },
    { id: 'AYT Kimya', konular: ['Modern Atom Teorisi', 'Gazlar', 'Sıvı Çözeltiler ve Çözünürlük', 'Kimyasal Tepkimelerde Enerji', 'Tepkime Hızları', 'Kimyasal Denge', 'Asit-Baz Dengesi', 'Çözünürlük Dengesi', 'Kimya ve Elektrik', 'Karbon Kimyasına Giriş', 'Organik Bileşikler', 'Enerji Kaynakları ve Bilimsel Gelişmeler'] },
    { id: 'AYT Biyoloji', konular: ['Sinir Sistemi', 'Endokrin Sistem', 'Duyu Organları', 'Destek ve Hareket Sistemi', 'Sindirim Sistemi', 'Dolaşım ve Bağışıklık Sistemi', 'Solunum Sistemi', 'Boşaltım Sistemi', 'Üreme Sistemi ve Embriyonik Gelişim', 'Komünite ve Popülasyon Ekolojisi', 'Nükleik Asitler', 'Genetik Şifre ve Protein Sentezi', 'Biyoteknoloji ve Gen Mühendisliği', 'Fotosentez ve Kemosentez', 'Hücresel Solunum', 'Bitki Biyolojisi', 'Canlılar ve Çevre'] }
  ];

  // Kaynaklar: ders alanına göre (TYT ve AYT kitapları ayrı listelenir)
  const K = {
    mat_tyt: ['Bilgi Sarmal', '3D', 'Orijinal', 'Acil', 'Endemik', 'Limit', 'Karekök', 'Apotemi', 'Hız ve Renk', 'Eyüp B.', 'Yayın Denizi', 'Paraf', 'Tonguç', 'Miray'],
    mat_ayt: ['Bilgi Sarmal', '3D', 'Orijinal', 'Acil', 'Endemik', 'Limit', 'Apotemi', 'Karekök', 'Tonguç', 'Yayın Denizi', 'Paraf'],
    fiz: ['345', '3D', 'Nihat Bilgin', 'Palme', 'Aydın', 'Endemik', 'Bilgi Sarmal', 'Paraf', 'Yayın Denizi'],
    kim: ['Palme', '345', 'Orbital', 'Aydın', 'Miray', 'Endemik', '3D', 'Bilgi Sarmal', 'VİP'],
    bio: ['Palme', 'Biyotik', 'Endemik', '3D', 'Bilgi Sarmal', 'Yayın Denizi', 'Editör', 'Simya', 'Paraf'],
    tur: ['Hız ve Renk', 'Limit', 'Bilgi Sarmal', '3D', 'Benim Hocam', 'Sınav', 'Yargı', 'Paragrafın Ritmi', 'Karekök', 'İsem', 'Tonguç'],
    tar: ['Hız ve Renk', 'Benim Hocam', '3D', 'Sınav', 'Palme', 'Yediiklim', 'Endemik'],
    cog: ['Hız ve Renk', 'Benim Hocam', '3D', 'Sınav', 'Yediiklim', 'Endemik', 'Coğrafyanın Kodları']
  };
  const KAYNAK = {
    'TYT Matematik': K.mat_tyt, 'AYT Matematik': K.mat_ayt,
    'TYT Fizik': K.fiz, 'AYT Fizik': K.fiz, 'TYT Kimya': K.kim, 'AYT Kimya': K.kim,
    'TYT Biyoloji': K.bio, 'AYT Biyoloji': K.bio, 'TYT Türkçe': K.tur, 'TYT Tarih': K.tar, 'TYT Coğrafya': K.cog
  };

  // Hata nedenleri (çözümden sonra seçilir)
  const REASONS = [
    { id: 'konu', label: 'Konu eksiği' },
    { id: 'islem', label: 'İşlem hatası' },
    { id: 'dikkat', label: 'Dikkat hatası' },
    { id: 'okuma', label: 'Soruyu yanlış okuma' },
    { id: 'sure', label: 'Süre yetmedi' },
    { id: 'diger', label: 'Diğer' }
  ];

  global.Catalog = {
    dersler: DERSLER.map(d => d.id),
    konular: (ders) => (DERSLER.find(d => d.id === ders) || {}).konular || [],
    kaynaklar: (ders) => KAYNAK[ders] || [...new Set(Object.values(K).flat())],
    REASONS
  };
})(window);
