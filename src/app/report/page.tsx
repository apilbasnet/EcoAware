"use client";
import { useState, useEffect, useRef } from "react";
import { MapPin, Upload, CheckCircle, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleGenAI } from "@google/genai";
import { useJsApiLoader } from "@react-google-maps/api";
import { Libraries } from "@react-google-maps/api";
import {
  classifyWasteImage,
  MIN_CONFIDENCE,
  MIN_MARGIN,
} from "@/utils/wasteClassifier";
import { parseKg } from "@/utils/priority";
import {
  createUser,
  getUserByEmail,
  createReport,
  getRecentReports,
} from "@/utils/db/actions";
import { toast } from "react-hot-toast";
import { useWeb3Auth } from "@/hooks/useWeb3Auth";
import { generateWithFallback, isQuotaError } from "@/utils/GeminiModels";

const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const libraries: Libraries = ["places"];

export default function ReportPage() {
  const { loggedIn, loading: authLoading, login } = useWeb3Auth();
  const [user, setUser] = useState<{
    id: number;
    email: string;
    name: string;
  } | null>(null);

  const [reports, setReports] = useState<
    Array<{
      id: number;
      location: string;
      wasteType: string;
      amount: string;
      createdAt: string;
    }>
  >([]);

  const [newReport, setNewReport] = useState({
    location: "",
    type: "",
    amount: "",
  });

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<
    "idle" | "verifying" | "success" | "failure"
  >("idle");
  const [verificationResult, setVerificationResult] = useState<{
    wasteType: string;
    quantity: string;
    confidence: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Location suggestions (typed input + Google Places suggestions)
  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions, setSuggestions] = useState<
    { id: string; text: string }[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const sessionTokenRef = useRef<any>(null);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: googleMapsApiKey!,
    libraries: libraries,
  });

  // Single source of truth for loading the current user + their reports
  useEffect(() => {
    const checkUser = async () => {
      const email = localStorage.getItem("userEmail");
      if (email) {
        let dbUser = await getUserByEmail(email);
        if (!dbUser) {
          dbUser = await createUser(email, "Anonymous User");
        }
        setUser(dbUser);

        const recentReports = await getRecentReports();
        const formattedReports = recentReports.map((report) => ({
          ...report,
          createdAt: report.createdAt.toISOString().split("T")[0],
        }));
        setReports(formattedReports);
      }
    };
    checkUser();
  }, [loggedIn]); // re-run once login completes, so `user` populates right after login

  // Fetch location suggestions (debounced). Typing always works even if this fails.
  useEffect(() => {
    const q = locationQuery.trim();
    if (!isLoaded || q.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } =
          (await google.maps.importLibrary("places")) as any;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const { suggestions: results } =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: q,
            sessionToken: sessionTokenRef.current,
          });
        if (cancelled) return;
        setSuggestions(
          results
            .filter((s: any) => s.placePrediction)
            .map((s: any, i: number) => ({
              id: s.placePrediction.placeId ?? String(i),
              text: s.placePrediction.text.text as string,
            })),
        );
      } catch (err) {
        console.error("Location suggestions failed:", err);
        setSuggestions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [locationQuery, isLoaded]);

  const handleLocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocationQuery(value); // triggers suggestions
    setNewReport((prev) => ({ ...prev, location: value })); // typed text counts
    setShowSuggestions(true);
  };

  const selectSuggestion = (text: string) => {
    setNewReport((prev) => ({ ...prev, location: text }));
    setSuggestions([]);
    setShowSuggestions(false);
    sessionTokenRef.current = null; // start a new session after a selection
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setNewReport({ ...newReport, [name]: value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      // New photo -> old verification no longer applies
      setVerificationStatus("idle");
      setVerificationResult(null);
      setNewReport((prev) => ({ ...prev, type: "", amount: "" }));
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const failVerification = (message: string) => {
    setVerificationResult(null);
    setNewReport((prev) => ({ ...prev, type: "", amount: "" }));
    setVerificationStatus("failure");
    toast.error(message);
  };

  const handleVerify = async () => {
    if (!loggedIn) {
      toast.error("Please log in to verify waste.");
      login();
      return;
    }
    if (!file) return;

    setVerificationStatus("verifying");

    // Step 1: classify the waste type on-device with the TF.js model
    let classification;
    try {
      classification = await classifyWasteImage(file);
    } catch (error) {
      console.error("Waste classifier failed:", error);
      failVerification(
        "Couldn't run the waste classifier. Please refresh and try again.",
      );
      return;
    }

    if (
      classification.confidence < MIN_CONFIDENCE ||
      classification.margin < MIN_MARGIN
    ) {
      failVerification(
        "Couldn't confidently identify waste in this image. Please upload a clearer photo of the waste.",
      );
      return;
    }

    // Step 2: estimate the quantity with Gemini (uses one API request)
    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey! });
      const base64Data = await readFileAsBase64(file);

      const quantityPrompt = `This image has been classified as "${classification.wasteType}" waste.
      Estimate the quantity or amount of this waste in kg or liters. Respond with just the estimate, e.g. "2.5 kg".`;

      const result = await generateWithFallback(ai, {
        contents: [
          {
            role: "user",
            parts: [
              { text: quantityPrompt },
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data.split(",")[1],
                },
              },
            ],
          },
        ],
      });

      // Gemini answers "none" when the image isn't waste at all
      const answer = (result.text ?? "").trim().toLowerCase();

      // Normalise whatever the model said into a clean "X kg" string
      const kg = parseKg(answer);
      if (!(kg > 0)) {
        failVerification(
          "Couldn't estimate the amount of waste. Please try another photo.",
        );
        return;
      }
      const quantity = `${Math.max(0.1, Math.round(kg * 10) / 10)} kg`;

      const parsedResult = {
        wasteType: classification.wasteType,
        quantity,
        confidence: classification.confidence,
      };

      setVerificationResult(parsedResult);
      setVerificationStatus("success");
      setNewReport((prev) => ({
        ...prev,
        type: parsedResult.wasteType,
        amount: parsedResult.quantity,
      }));
    } catch (error) {
      console.error("Error estimating quantity:", error);
      failVerification(
        isQuotaError(error)
          ? "Amount estimation has hit its daily limit. Please try again later."
          : "Verification failed. Please try again.",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loggedIn) {
      toast.error("Please log in to submit a report.");
      login();
      return;
    }
    if (verificationStatus !== "success" || !user) {
      toast.error("Please verify the waste before submitting.");
      return;
    }
    if (newReport.location.trim().length < 3) {
      toast.error("Please enter the waste location (at least 3 characters).");
      return;
    }
    if (!newReport.type || !newReport.amount) {
      toast.error(
        "Waste type and amount are missing. Please verify the waste first.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const report = (await createReport(
        user.id,
        newReport.location,
        newReport.type,
        newReport.amount,
        preview || undefined,
        verificationResult ? JSON.stringify(verificationResult) : undefined,
      )) as any;

      const formattedReport = {
        id: report.id,
        location: report.location,
        wasteType: report.wasteType,
        amount: report.amount,
        createdAt: report.createdAt.toISOString().split("T")[0],
      };

      setReports([formattedReport, ...reports]);
      setNewReport({ location: "", type: "", amount: "" });
      setLocationQuery("");
      setSuggestions([]);
      setFile(null);
      setPreview(null);
      setVerificationStatus("idle");
      setVerificationResult(null);

      toast.success(
        `Report submitted successfully! You've earned points for reporting waste.`,
      );
    } catch (error) {
      console.error("Error submitting report:", error);
      toast.error("Failed to submit report. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader className="animate-spin h-8 w-8 text-gray-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6 text-gray-800">
        Report waste 
      </h1>

      {!loggedIn && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-amber-800">
            You're viewing the report form. Log in to upload, verify, and submit
            a report.
          </p>
          <Button
            onClick={login}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            Log In
          </Button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-2xl shadow-lg mb-12"
      >
        <div className="mb-8">
          <label
            htmlFor="waste-image"
            className="block text-lg font-medium text-gray-700 mb-2"
          >
            Upload Waste Image
          </label>
          <div
            className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-xl transition-colors duration-300 ${
              !loggedIn
                ? "opacity-50 pointer-events-none"
                : "hover:border-green-500"
            }`}
          >
            <div className="space-y-1 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="flex text-sm text-gray-600">
                <label
                  htmlFor="waste-image"
                  className="relative cursor-pointer bg-white rounded-md font-medium text-green-600 hover:text-green-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-green-500"
                >
                  <span>Upload a file</span>
                  <input
                    id="waste-image"
                    name="waste-image"
                    type="file"
                    className="sr-only"
                    onChange={handleFileChange}
                    accept="image/*"
                    disabled={!loggedIn}
                  />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
            </div>
          </div>
        </div>

        {preview && (
          <div className="mt-4 mb-8">
            <img
              src={preview}
              alt="Waste preview"
              className="max-w-full h-auto rounded-xl shadow-md"
            />
          </div>
        )}

        <Button
          type="button"
          onClick={handleVerify}
          className="w-full mb-8 bg-blue-600 hover:bg-blue-700 text-white py-3 text-lg rounded-xl transition-colors duration-300"
          disabled={!file || verificationStatus === "verifying" || !loggedIn}
        >
          {verificationStatus === "verifying" ? (
            <>
              <Loader className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
              Verifying...
            </>
          ) : (
            "Verify Waste"
          )}
        </Button>

        {verificationStatus === "success" && verificationResult && (
          <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-8 rounded-r-xl">
            <div className="flex items-center">
              <CheckCircle className="h-6 w-6 text-green-400 mr-3" />
              <div>
                <h3 className="text-lg font-medium text-green-800">
                  Verification Successful
                </h3>
                <div className="mt-2 text-sm text-green-700">
                  <p>Waste Type: {verificationResult.wasteType}</p>
                  <p>Quantity: {verificationResult.quantity}</p>
                  <p>
                    Confidence:{" "}
                    {(verificationResult.confidence * 100).toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="relative">
            <label
              htmlFor="location"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Location <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="location"
              name="location"
              value={newReport.location}
              onChange={handleLocationChange}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              disabled={!loggedIn}
              autoComplete="off"
              className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 disabled:opacity-50"
              placeholder="Search or type the waste location"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep focus so onBlur doesn't hide the list first
                        selectSuggestion(s.text);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                    >
                      <MapPin className="w-4 h-4 mr-2 text-green-500 shrink-0" />
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label
              htmlFor="type"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Waste Type
            </label>
            <input
              type="text"
              id="type"
              name="type"
              value={newReport.type}
              onChange={handleInputChange}
              required
              disabled={!loggedIn}
              className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 bg-gray-100 disabled:opacity-50"
              placeholder="Verified waste type"
              readOnly
            />
          </div>
          <div>
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Estimated Amount
            </label>
            <input
              type="text"
              id="amount"
              name="amount"
              value={newReport.amount}
              onChange={handleInputChange}
              required
              disabled={!loggedIn}
              className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 bg-gray-100 disabled:opacity-50"
              placeholder="Verified amount"
              readOnly
            />
          </div>
        </div>
        <Button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-3 text-lg rounded-xl transition-colors duration-300 flex items-center justify-center"
          disabled={
            isSubmitting ||
            !loggedIn ||
            newReport.location.trim().length < 3 ||
            !newReport.type ||
            !newReport.amount
          }
        >
          {isSubmitting ? (
            <>
              <Loader className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
              Submitting...
            </>
          ) : (
            "Submit Report"
          )}
        </Button>
      </form>

      <h2 className="text-3xl font-semibold mb-6 text-gray-800">
        Recent Reports
      </h2>
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Location
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {reports.map((report) => (
                <tr
                  key={report.id}
                  className="hover:bg-gray-50 transition-colors duration-200"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <MapPin className="inline-block w-4 h-4 mr-2 text-green-500" />
                    {report.location}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {report.wasteType}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {report.amount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {report.createdAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}