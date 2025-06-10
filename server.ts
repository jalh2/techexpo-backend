import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const PORT: string | number = process.env.PORT || 5000;

// Configure CORS to accept all origins, headers, and methods
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Anthropic API configuration
const ANTHROPIC_API_KEY: string | undefined = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL: string = 'https://api.anthropic.com/v1/messages';

interface Conditions {
    [key: string]: string[];
}

// Common diseases in West Africa/Liberia for context
const COMMON_CONDITIONS: Conditions = {
  infectious: [
    'Malaria', 'Typhoid fever', 'Dengue fever', 'Yellow fever',
    'Hepatitis A/B', 'Cholera', 'Meningitis', 'Tuberculosis',
    'Schistosomiasis', 'Onchocerciasis (River blindness)'
  ],
  respiratory: [
    'Upper respiratory tract infection', 'Pneumonia', 'Bronchitis',
    'Asthma', 'Allergic rhinitis'
  ],
  gastrointestinal: [
    'Gastroenteritis', 'Food poisoning', 'Peptic ulcer',
    'Irritable bowel syndrome', 'Parasitic infections'
  ],
  skin: [
    'Fungal skin infections', 'Bacterial skin infections',
    'Eczema', 'Scabies', 'Insect bites'
  ]
};

// Severity classification keywords
const SEVERITY_INDICATORS: Conditions = {
  emergency: [
    'difficulty breathing', 'chest pain', 'severe bleeding',
    'loss of consciousness', 'severe dehydration', 'high fever above 39°C',
    'persistent vomiting', 'severe abdominal pain', 'confusion'
  ],
  urgent: [
    'persistent fever', 'severe headache', 'persistent diarrhea',
    'significant weight loss', 'persistent cough', 'severe fatigue'
  ],
  mild: [
    'mild headache', 'minor rash', 'mild nausea', 'minor aches',
    'mild cough', 'slight fever'
  ]
};

interface Symptoms {
    gender: string;
    physicalSymptoms: string;
    internalSymptoms: string;
}

// Function to build Anthropic prompt
function buildDiagnosisPrompt(symptoms: Symptoms): string {
  const { gender, physicalSymptoms, internalSymptoms } = symptoms;
  
  return `You are a medical AI assistant helping with symptom assessment in Liberia, West Africa. 
  
IMPORTANT: Always emphasize that this is not a substitute for professional medical care.

Patient Information:
- Gender: ${gender}
- Physical symptoms: ${physicalSymptoms}
- Internal symptoms: ${internalSymptoms}

Context: This patient is in Liberia, West Africa. Consider common regional health conditions including:
- Malaria (very common)
- Typhoid fever
- Dengue fever
- Gastrointestinal infections
- Respiratory infections
- Skin conditions due to climate

Please provide:
1. Most likely condition(s) based on symptoms
2. Severity assessment (Emergency/Urgent/Mild)
3. Immediate care recommendations
4. When to seek professional medical help
5. Preventive measures
6. Additional questions that might help narrow diagnosis

Format your response as JSON with the following structure:
{
  "primaryDiagnosis": "Most likely condition",
  "alternativeDiagnoses": ["Alternative 1", "Alternative 2"],
  "severity": "Emergency|Urgent|Mild",
  "urgencyLevel": "Seek immediate medical attention|Consult healthcare provider within 24-48 hours|Monitor symptoms and seek care if worsening",
  "treatmentRecommendations": ["Recommendation 1", "Recommendation 2"],
  "warningSignsToWatch": ["Warning sign 1", "Warning sign 2"],
  "additionalQuestions": ["Question 1", "Question 2"],
  "preventiveMeasures": ["Prevention 1", "Prevention 2"],
  "disclaimer": "This assessment is for informational purposes only. Always consult healthcare professionals for proper diagnosis and treatment."
}

Important: If symptoms suggest a potentially serious condition, always recommend immediate medical attention.`;
}

// Function to assess severity based on keywords
function assessSeverityFromSymptoms(physicalSymptoms: string, internalSymptoms: string): string {
  const allSymptoms: string = `${physicalSymptoms} ${internalSymptoms}`.toLowerCase();
  
  const emergencyFound: boolean = SEVERITY_INDICATORS.emergency.some(indicator => 
    allSymptoms.includes(indicator.toLowerCase())
  );
  
  const urgentFound: boolean = SEVERITY_INDICATORS.urgent.some(indicator => 
    allSymptoms.includes(indicator.toLowerCase())
  );
  
  if (emergencyFound) return 'Emergency';
  if (urgentFound) return 'Urgent';
  return 'Mild';
}

interface Diagnosis {
    primaryDiagnosis: string;
    alternativeDiagnoses?: string[];
    severity: string;
    urgencyLevel: string;
    treatmentRecommendations: string[];
    warningSignsToWatch?: string[];
    additionalQuestions?: string[];
    preventiveMeasures?: string[];
    disclaimer: string;
}

// Main diagnosis endpoint
app.post('/api/diagnose', async (req: Request, res: Response) => {
  try {
    const { gender, physicalSymptoms, internalSymptoms }: Symptoms = req.body;
    
    // Validate input
    if (!gender || !physicalSymptoms || !internalSymptoms) {
      return res.status(400).json({
        error: 'Missing required fields: gender, physicalSymptoms, internalSymptoms'
      });
    }

    // Build prompt for Anthropic
    const prompt: string = buildDiagnosisPrompt(req.body);
    
    // Call Anthropic API
    const anthropicResponse = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    console.log('Anthropic API response:', anthropicResponse.data);

    // Parse the response
    let diagnosis: Diagnosis;
    try {
      const responseContent: string = anthropicResponse.data.content[0].text;
      // Extract JSON from response if it's wrapped in other text
      const jsonMatch: RegExpMatchArray | null = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        diagnosis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing Anthropic response:', parseError);
      // Fallback response
      diagnosis = {
        primaryDiagnosis: "Unable to determine specific condition",
        severity: assessSeverityFromSymptoms(physicalSymptoms, internalSymptoms),
        urgencyLevel: "Consult healthcare provider for proper diagnosis",
        treatmentRecommendations: ["Seek professional medical evaluation"],
        disclaimer: "This assessment is for informational purposes only. Always consult healthcare professionals for proper diagnosis and treatment."
      };
    }

    // Add timestamp and session info
    const response = {
      ...diagnosis,
      timestamp: new Date().toISOString(),
      patientData: {
        gender,
        physicalSymptoms,
        internalSymptoms
      }
    };

    res.json(response);

  } catch (error: any) {
    console.error('API Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint to get common conditions
app.get('/api/conditions', (req: Request, res: Response) => {
  res.status(200).json(COMMON_CONDITIONS);
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
