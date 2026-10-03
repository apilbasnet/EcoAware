"use client";
import { useState, useEffect, useMemo } from "react";
import {
  Trash2,
  MapPin,
  CheckCircle,
  Clock,
  ArrowRight,
  Camera,
  Upload,
  Loader,
  Calendar,
  Weight,
  Search,
  Pin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "react-hot-toast";
import {
  getWasteCollectionTasks,
  updateTaskStatus,
  saveReward,
  saveCollectedWaste,
  getUserByEmail,
} from "@/utils/db/actions";
import { GoogleGenAI, Type } from "@google/genai";
import { useWeb3Auth } from "@/hooks/useWeb3Auth";
import { priorityScore, priorityLabel } from "@/utils/priority";

import { generateWithFallback, isQuotaError } from "@/utils/GeminiModels";

// Make sure to set your Gemini API key in your environment variables
const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

type CollectionTask = {
  id: number;
  location: string;
  wasteType: string;
  amount: string;
  status: "pending" | "in_progress" | "completed" | "verified";
  date: string;
  collectorId: number | null;
};

const ITEMS_PER_PAGE = 5;

export default function CollectPage() {
  const { loggedIn, login } = useWeb3Auth();

  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredWasteType, setHoveredWasteType] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [user, setUser] = useState<{
    id: number;
    email: string;
    name: string;
  } | null>(null);

  // Priority algorithm state
  const [sortMode, setSortMode] = useState<"priority" | "date">("priority");
  const [pinnedIds, setPinnedIds] = useState<number[]>([]); // administrative override

  const togglePin = (id: number) =>
    setPinnedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );

  useEffect(() => {
    const fetchUserAndTasks = async () => {
      setLoading(true);
      try {
        // Fetch user
        const userEmail = localStorage.getItem("userEmail");
        if (userEmail) {
          const fetchedUser = await getUserByEmail(userEmail);
          if (fetchedUser) {
            setUser(fetchedUser);
          } else {
            toast.error("User not found. Please log in again.");
          }
        } else {
        }

        // Fetch tasks
        const fetchedTasks = await getWasteCollectionTasks();
        setTasks(fetchedTasks as CollectionTask[]);
      } catch (error) {
        console.error("Error fetching user and tasks:", error);
        toast.error("Failed to load user data and tasks. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchUserAndTasks();
  }, [loggedIn]);

  // Go back to page 1 when the search or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortMode]);

  const [selectedTask, setSelectedTask] = useState<CollectionTask | null>(null);
  const [verificationImage, setVerificationImage] = useState<string | null>(
    null,
  );
  const [verificationStatus, setVerificationStatus] = useState<
    "idle" | "verifying" | "success" | "failure"
  >("idle");
  const [verificationResult, setVerificationResult] = useState<{
    wasteTypeMatch: boolean;
    quantityMatch: boolean;
    confidence: number;
  } | null>(null);
  const [reward, setReward] = useState<number | null>(null);

  const handleStatusChange = async (
    taskId: number,
    newStatus: CollectionTask["status"],
  ) => {
    if (!user) {
      toast.error("Please log in to collect waste.");
      login();
      return;
    }

    try {
      const updatedTask = await updateTaskStatus(taskId, newStatus, user.id);
      if (updatedTask) {
        setTasks((prev) =>
          prev.map((task) =>
            task.id === taskId
              ? { ...task, status: newStatus, collectorId: user.id }
              : task,
          ),
        );
        toast.success("Task status updated successfully");
      } else {
        toast.error("Failed to update task status. Please try again.");
      }
    } catch (error) {
      console.error("Error updating task status:", error);
      toast.error("Failed to update task status. Please try again.");
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setVerificationImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const readFileAsBase64 = (dataUrl: string): string => {
    return dataUrl.split(",")[1];
  };

  const handleVerify = async () => {
    if (!selectedTask || !verificationImage || !user) {
      if (!user) {
        toast.error("Please log in to verify this collection.");
        login();
        return;
      }
      toast.error("Missing required information for verification.");
      return;
    }
    setVerificationStatus("verifying");

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey! });

      const base64Data = readFileAsBase64(verificationImage);

      const prompt = `You are an expert in waste management and recycling. Analyze this image and provide:
        1. Confirm if the waste type matches: ${selectedTask.wasteType}
        2. Estimate if the quantity matches: ${selectedTask.amount}
        3. Your confidence level in this assessment (as a number between 0 and 1)`;

      const mimeType =
        verificationImage.match(/^data:(.*?);base64,/)?.[1] ?? "image/jpeg";

      const result = await generateWithFallback(ai, {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              wasteTypeMatch: { type: Type.BOOLEAN },
              quantityMatch: { type: Type.BOOLEAN },
              confidence: { type: Type.NUMBER },
            },
            required: ["wasteTypeMatch", "quantityMatch", "confidence"],
          },
        },
      });

      const text = result.text;

      try {
        const parsedResult = JSON.parse(text!);
        setVerificationResult({
          wasteTypeMatch: parsedResult.wasteTypeMatch,
          quantityMatch: parsedResult.quantityMatch,
          confidence: parsedResult.confidence,
        });
        setVerificationStatus("success");

        if (
          parsedResult.wasteTypeMatch &&
          parsedResult.quantityMatch &&
          parsedResult.confidence > 0.7
        ) {
          await handleStatusChange(selectedTask.id, "verified");
          const earnedReward = Math.floor(Math.random() * 50) + 10;

          await saveReward(user.id, earnedReward);
          await saveCollectedWaste(selectedTask.id, user.id, parsedResult);

          setReward(earnedReward);
          toast.success(
            `Verification successful! You earned ${earnedReward} tokens!`,
            {
              duration: 5000,
              position: "top-center",
            },
          );
        } else {
          toast.error(
            "Verification failed. The collected waste does not match the reported waste.",
            {
              duration: 5000,
              position: "top-center",
            },
          );
        }
      } catch (error) {
        console.log(error);
        console.error("Failed to parse JSON response:", text);
        setVerificationStatus("failure");
      }
    } catch (error) {
      console.error("Error verifying waste:", error);
      if (isQuotaError(error)) {
        toast.error(
          "AI verification has hit its daily limit. Please try again later.",
        );
      }
      setVerificationStatus("failure");
    }
  };

  // Collection Priority Algorithm:
  // Score = 0.50 x Urgency + 0.30 x Age + 0.20 x Quantity (see utils/priority.ts)
  const rankedTasks = useMemo(() => {
    const filtered = tasks
      .filter((t) =>
        t.location.toLowerCase().includes(searchTerm.toLowerCase()),
      )
      .map((t) => ({ ...t, priority: priorityScore(t) }));

    if (sortMode === "date") {
      return filtered.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    }

    const group = (s: string) =>
      s === "pending" ? 0 : s === "in_progress" ? 1 : 2;
    return filtered.sort((a, b) => {
      const pa = pinnedIds.includes(a.id) ? 1 : 0;
      const pb = pinnedIds.includes(b.id) ? 1 : 0;
      if (pa !== pb) return pb - pa; // human override first
      if (group(a.status) !== group(b.status))
        return group(a.status) - group(b.status);
      return b.priority.score - a.priority.score; // highest score first
    });
  }, [tasks, searchTerm, sortMode, pinnedIds]);

  const pageCount = Math.max(1, Math.ceil(rankedTasks.length / ITEMS_PER_PAGE));
  const paginatedTasks = rankedTasks.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6 text-gray-800">
        Waste Collection Tasks
      </h1>

      <div className="mb-4 flex items-center">
        <Input
          type="text"
          placeholder="Search by area..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mr-2"
        />
        <Button variant="outline" size="icon">
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-4 flex gap-2 text-sm">
        <Button
          size="sm"
          variant={sortMode === "priority" ? "default" : "outline"}
          onClick={() => setSortMode("priority")}
        >
          Priority
        </Button>
        <Button
          size="sm"
          variant={sortMode === "date" ? "default" : "outline"}
          onClick={() => setSortMode("date")}
        >
          Newest
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader className="animate-spin h-8 w-8 text-gray-500" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {paginatedTasks.map((task) => (
              <div
                key={task.id}
                className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
              >
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-lg font-medium text-gray-800 flex items-center">
                    <MapPin className="w-5 h-5 mr-2 text-gray-500" />
                    {task.location}
                  </h2>
                  <div className="flex items-center gap-2">
                    {task.status === "pending" &&
                      (() => {
                        const label = priorityLabel(task.priority.score);
                        return (
                          <span
                            title={`Urgency ${
                              task.priority.urgency
                            } · Age ${task.priority.age.toFixed(
                              0,
                            )} · Qty ${task.priority.quantity.toFixed(0)}`}
                            className={`px-2 py-1 rounded-full text-xs font-medium ${label.color}`}
                          >
                            {label.text} · {task.priority.score}
                          </span>
                        );
                      })()}
                    {task.status === "pending" && (
                      <button
                        onClick={() => togglePin(task.id)}
                        title="Pin to top (admin override)"
                      >
                        <Pin
                          className={`h-4 w-4 ${
                            pinnedIds.includes(task.id)
                              ? "text-blue-600"
                              : "text-gray-400"
                          }`}
                        />
                      </button>
                    )}
                    <StatusBadge status={task.status} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm text-gray-600 mb-3">
                  <div className="flex items-center relative">
                    <Trash2 className="w-4 h-4 mr-2 text-gray-500" />
                    <span
                      onMouseEnter={() => setHoveredWasteType(task.wasteType)}
                      onMouseLeave={() => setHoveredWasteType(null)}
                      className="cursor-pointer"
                    >
                      {task.wasteType.length > 10
                        ? `${task.wasteType.slice(0, 8)}...`
                        : task.wasteType}
                    </span>
                    {hoveredWasteType === task.wasteType && (
                      <div className="absolute left-0 top-full mt-1 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-10">
                        {task.wasteType}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center">
                    <Weight className="w-4 h-4 mr-2 text-gray-500" />
                    {task.amount}
                  </div>
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-gray-500" />
                    {task.date}
                  </div>
                </div>
                <div className="flex justify-end">
                  {task.status === "pending" && (
                    <Button
                      onClick={() => handleStatusChange(task.id, "in_progress")}
                      variant="outline"
                      size="sm"
                    >
                      Start Collection
                    </Button>
                  )}
                  {task.status === "in_progress" &&
                    task.collectorId === user?.id && (
                      <Button
                        onClick={() => {
                          setSelectedTask(task);
                          setVerificationImage(null);
                          setVerificationStatus("idle");
                          setVerificationResult(null);
                        }}
                        variant="outline"
                        size="sm"
                      >
                        Complete & Verify
                      </Button>
                    )}
                  {task.status === "in_progress" &&
                    task.collectorId !== user?.id && (
                      <span className="text-yellow-600 text-sm font-medium">
                        In progress by another collector
                      </span>
                    )}
                  {task.status === "verified" && (
                    <span className="text-green-600 text-sm font-medium">
                      Reward Earned
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-center">
            <Button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="mr-2"
            >
              Previous
            </Button>
            <span className="mx-2 self-center">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, pageCount))
              }
              disabled={currentPage === pageCount}
              className="ml-2"
            >
              Next
            </Button>
          </div>
        </>
      )}

      {selectedTask && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">Verify Collection</h3>
            <p className="mb-4 text-sm text-gray-600">
              Upload a photo of the collected waste to verify and earn your
              reward.
            </p>
            <div className="mb-4">
              <label
                htmlFor="verification-image"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Upload Image
              </label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                <div className="space-y-1 text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="flex text-sm text-gray-600">
                    <label
                      htmlFor="verification-image"
                      className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
                    >
                      <span>Upload a file</span>
                      <input
                        id="verification-image"
                        name="verification-image"
                        type="file"
                        className="sr-only"
                        onChange={handleImageUpload}
                        accept="image/*"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">
                    PNG, JPG, GIF up to 10MB
                  </p>
                </div>
              </div>
            </div>
            {verificationImage && (
              <img
                src={verificationImage}
                alt="Verification"
                className="mb-4 rounded-md w-full"
              />
            )}
            <Button
              onClick={handleVerify}
              className="w-full"
              disabled={
                !verificationImage || verificationStatus === "verifying"
              }
            >
              {verificationStatus === "verifying" ? (
                <>
                  <Loader className="animate-spin -ml-1 mr-3 h-5 w-5" />
                  Verifying...
                </>
              ) : (
                "Verify Collection"
              )}
            </Button>
            {verificationStatus === "success" && verificationResult && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <p>
                  Waste Type Match:{" "}
                  {verificationResult.wasteTypeMatch ? "Yes" : "No"}
                </p>
                <p>
                  Quantity Match:{" "}
                  {verificationResult.quantityMatch ? "Yes" : "No"}
                </p>
                <p>
                  Confidence: {(verificationResult.confidence * 100).toFixed(2)}
                  %
                </p>
              </div>
            )}
            {verificationStatus === "failure" && (
              <p className="mt-2 text-red-600 text-center text-sm">
                Verification failed. Please try again.
              </p>
            )}
            <Button
              onClick={() => setSelectedTask(null)}
              variant="outline"
              className="w-full mt-2"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Add a conditional render to show user info or login prompt */}
      {/* {user ? (
        <p className="text-sm text-gray-600 mb-4">Logged in as: {user.name}</p>
      ) : (
        <p className="text-sm text-red-600 mb-4">Please log in to collect waste and earn rewards.</p>
      )} */}
    </div>
  );
}

function StatusBadge({ status }: { status: CollectionTask["status"] }) {
  const statusConfig = {
    pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock },
    in_progress: { color: "bg-blue-100 text-blue-800", icon: Trash2 },
    completed: { color: "bg-green-100 text-green-800", icon: CheckCircle },
    verified: { color: "bg-purple-100 text-purple-800", icon: CheckCircle },
  };

  const { color, icon: Icon } = statusConfig[status];

  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${color} flex items-center`}
    >
      <Icon className="mr-1 h-3 w-3" />
      {status.replace("_", " ")}
    </span>
  );
}
