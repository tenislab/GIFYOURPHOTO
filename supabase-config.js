// Conexión de la galería con Supabase.
window.JRR_SUPABASE = {
  url: "https://lclvboyfwwegvyyjpscw.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjbHZib3lmd3dlZ3Z5eWpwc2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5ODQ3MTksImV4cCI6MjEwMzU2MDcxOX0.mXSRetKBeOazJbMXOfHyRDZzcIpP7qIwyLe5CNS4BOU"
};

// Datos de cobro que se muestran en las instrucciones de pago.
window.JRR_PAY = {
  revolut: "@jaimerivas",
  iban: "ES55 0182 5332 1800 0179 4028",
  bic: "BBVAESMM",
  holder: "Jaime Rivas Reinoso",
  phone: "+34 618 648 370"
};

// Nombre real (slug) de cada función en Supabase. Al renombrar una función en el
// panel, el título cambia pero la dirección no: aquí va la dirección real.
window.JRR_FUNCTIONS = {
  download: "Download",
  watermark: "watermark",
  notify: "notify"
};
