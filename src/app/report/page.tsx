"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { MapPin, Upload, CheckCircle, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleGenAI, Type } from "@google/genai";
import { useJsApiLoader } from "@react-google-maps/api";
import { Libraries } from "@react-google-maps/api";
import { classifyWasteImage } from '@/utils/wasteClassifier'
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

  const autocompleteContainerRef = useRef<HTMLDivElement>(null);
  const autocompleteElementRef = useRef<any>(null);

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

  // Mount Google Places autocomplete once script is loaded
  useEffect(() => {
    if (!isLoaded || authLoading) return;
    const container = autocompleteContainerRef.current;
    if (!container) return;

    let cancelled = false;
    let element: any;

    const init = async () => {
      const { PlaceAutocompleteElement } = await google.maps.importLibrary(
        "places",
      );
      if (cancelled) return;

      element = new PlaceAutocompleteElement();
      element.id = "location-autocomplete";
      element.style.colorScheme = "light";
      element.style.backgroundColor = "#ffffff";
      autocompleteElementRef.current = element;
      container.appendChild(element);

      element.addEventListener(
        "gmp-select",
        async (event: google.maps.places.PlacePredictionSelectEvent) => {
          const prediction = event.placePrediction.toPlace();
          const { place } = await prediction.fetchFields({
            fields: ["formattedAddress"],
          });
          setNewReport((prev) => ({
            ...prev,
            location: place.formattedAddress || "",
          }));
        },
      );
    };

    init();

    return () => {
      cancelled = true;
      element?.remove();
      autocompleteElementRef.current = null;
    };
  }, [isLoaded, authLoading]);

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

 const handleVerify = async () => {
    if (!loggedIn) {
      toast.error("Please log in to verify waste.");
      login();
      return;
    }
    if (!file) return;

    setVerificationStatus("verifying");

    try {
      const classification = await classifyWasteImage(file);

      if (classification.confidence < 0.5) {
        setVerificationStatus("failure");
        toast.error("Couldn't confidently identify waste in this image. Please upload a clearer photo.");
        return;
      }

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

      const quantity = result.text?.trim() || "Unknown";

      const parsedResult = {
        wasteType: classification.wasteType,
        quantity,
        confidence: classification.confidence,
      };

      setVerificationResult(parsedResult);
      setVerificationStatus("success");
      setNewReport({
        ...newReport,
        type: parsedResult.wasteType,
        amount: parsedResult.quantity,
      });
    } catch (error) {
      console.error("Error verifying waste:", error);
      setVerificationStatus("failure");
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
    if (!newReport.location.trim()) {
      toast.error("Please select a location from the suggestions.");
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
      setFile(null);
      setPreview(null);
      setVerificationStatus("idle");
      setVerificationResult(null);

      toast.success(
        `Report submitted successfully! You've earned points for reporting waste.`,
      );
    } catch (error) {
      console.error("Error verifying waste:", error);
      if (isQuotaError(error)) {
        toast.error(
          "AI verification has hit its daily limit. Please try again later.",
        );
      }
      setVerificationStatus("failure");
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
          <div>
            {isLoaded ? (
              <div>
                <label
                  htmlFor="location"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Location
                </label>
                <div
                  ref={autocompleteContainerRef}
                  className={`[&_gmp-place-autocomplete]:w-full [&_gmp-place-autocomplete]:border [&_gmp-place-autocomplete]:border-gray-300 [&_gmp-place-autocomplete]:rounded-xl ${
                    !loggedIn ? "opacity-50 pointer-events-none" : ""
                  }`}
                />
                {newReport.location && (
                  <p className="text-xs text-gray-500 mt-1">
                    Selected: {newReport.location}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label
                  htmlFor="location"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Location
                </label>
                <input
                  type="text"
                  id="location"
                  name="location"
                  value={newReport.location}
                  onChange={handleInputChange}
                  required
                  disabled={!loggedIn}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 disabled:opacity-50"
                  placeholder="Enter waste location"
                />
              </div>
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
            !newReport.location ||
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
            "Report"
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
