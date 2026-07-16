import { google } from 'googleapis';

export async function getCatalogoFlores() {
  try {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // 💡 TRUCO: Al poner solo 'A1:O500' sin el nombre de la pestaña, 
    // Google Sheets leerá automáticamente la primera pestaña visible del documento.
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A1:O500', 
    });

    const rows: any[][] = (response.data.values as any[][]) ?? [];
    if (!rows || rows.length === 0) {
      console.log('La hoja existe, pero está vacía.');
      return [];
    }

    const headers = rows[0]; 
    
    const catalogo = rows.slice(1).map((row: any[]) => {
      const producto: any = {};
      headers.forEach((header: string, index: number) => {
        producto[header] = row[index] || '';
      });
      return producto;
    });

    // Imprimimos el primer producto crudo en la terminal para ver exactamente qué letras tiene
    if (catalogo.length > 0) {
        console.log("🔍 Muestra cruda del primer producto:", catalogo[0]);
    }

    // 💡 TRUCO 2: Filtro relajado. Limpia espacios en blanco (.trim) 
    // y revisa si es "SI" o "SÍ" (con o sin acento) y si está en mayúscula o minúscula (.toUpperCase).
    const productosListosParaVender = catalogo.filter((p: any) => {
      const activo = p['Activo']?.trim().toUpperCase();
      const disponible = p['Disponible']?.trim().toUpperCase();
      
      return (activo === 'SÍ' || activo === 'SI') && (disponible === 'SÍ' || disponible === 'SI');
    });

    return productosListosParaVender;

  } catch (error) {
    console.error('❌ Error catastrófico al leer Google Sheets:', error);
    return [];
  }
}